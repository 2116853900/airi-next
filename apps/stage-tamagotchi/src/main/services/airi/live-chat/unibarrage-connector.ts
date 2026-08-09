import type { LiveRoomConfig, LiveRoomPlatform, LiveRoomStatus, UniBarrageBridgeConfig } from '@proj-airi/stage-shared/live-chat'

import type { LiveRoomConnector, LiveRoomConnectorCallbacks } from './connector'

import { useLogg } from '@guiiai/logg'
import { errorMessageFrom } from '@moeru/std'
import { mapUniBarrageMessage } from '@proj-airi/stage-shared/live-chat'

const RECONNECT_DELAY_MS = 3_000
const RECONCILE_INTERVAL_MS = 10_000
// UniBarrage silently drops a room when its platform listener dies; wait this
// long before re-registering so a genuinely broken room does not flap its
// status on every reconcile tick.
const FAILED_RETRY_COOLDOWN_MS = 30_000

// UniBarrage serves its management API under /api/v1 (see services/api/restful.go).
const UNIBARRAGE_API_PREFIX = '/api/v1'
// The bare root WebSocket path pushes every proxied platform; the connector
// filters client-side by the rooms it registered (services/websockets/connections.go).
const UNIBARRAGE_ROOT_WS_PATH = '/'

interface UniBarrageBridgeResponse {
  code: number
  message?: string
}

function roomKey(platform: LiveRoomPlatform, roomId: string): string {
  return `${platform}:${roomId}`
}

/**
 * Normalizes a WebSocket base URL to the root filter path so a single socket
 * receives every platform UniBarrage proxies.
 */
export function unibarrageWsUrl(base: string): string {
  try {
    const url = new URL(base)
    url.pathname = UNIBARRAGE_ROOT_WS_PATH
    return url.toString().replace(/\/$/, '')
  }
  catch {
    return base
  }
}

/**
 * Consumes Bilibili and Douyin live chat from the managed UniBarrage bridge.
 *
 * The bridge runs as a bundled child process (`services/airi/unibarrage`); the
 * app registers rooms through its HTTP API and subscribes to the unified
 * WebSocket push at the root path. Protocol drift therefore lives in the
 * engine, not in this repo.
 *
 * State model (per room, keyed by `platform:roomId`):
 *
 * - `registered` maps a room to its config id once UniBarrage confirmed the
 *   listener (HTTP 201, or HTTP 400 "已在监听中" verified via GET).
 * - A WebSocket is kept open against the root path; on (re)connect any enabled
 *   room missing from `registered` is registered again, so the connector
 *   self-heals when UniBarrage starts after the app.
 * - A reconcile tick re-registers missing rooms and probes registered ones;
 *   UniBarrage removes a room from its service list when the platform listener
 *   dies, which the probe turns into `error` instead of a silent `connected`.
 */
export function createUniBarrageConnector(params: {
  getBridge: () => UniBarrageBridgeConfig | undefined
  getRooms: () => LiveRoomConfig[]
} & LiveRoomConnectorCallbacks): LiveRoomConnector {
  const log = useLogg('main/live-chat/unibarrage').useGlobalConfig()
  let ws: WebSocket | undefined
  let wsOpen = false
  let stopped = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconcileTimer: ReturnType<typeof setInterval> | undefined
  const registered = new Map<string, string>() // platform:roomId -> room config id
  const retryAfter = new Map<string, number>() // platform:roomId -> epoch ms of next allowed attempt

  function activeRooms() {
    return params.getRooms().filter(room => (room.platform === 'bilibili' || room.platform === 'douyin') && room.enabled)
  }

  function setStatus(roomId: string, state: LiveRoomStatus['state'], error?: string) {
    params.onStatus(roomId, { state, error, updatedAt: Date.now() })
  }

  async function bridgeRequest(path: string, init?: RequestInit): Promise<Response> {
    const bridge = params.getBridge()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (bridge?.token)
      headers.Authorization = `Bearer ${bridge.token}`
    return await fetch(`${bridge?.apiUrl ?? ''}${path}`, { ...init, headers: { ...headers, ...init?.headers } })
  }

  /** Whether UniBarrage still lists a room; `unreachable` when the API is down. */
  async function bridgeExists(platform: LiveRoomPlatform, roomId: string): Promise<boolean | 'unreachable'> {
    try {
      const response = await bridgeRequest(`${UNIBARRAGE_API_PREFIX}/${platform}/${roomId}`)
      return response.ok
    }
    catch {
      return 'unreachable'
    }
  }

  async function registerRoom(room: LiveRoomConfig) {
    const key = roomKey(room.platform, room.roomId)
    const cooldownUntil = retryAfter.get(key)
    if (cooldownUntil != null) {
      if (Date.now() < cooldownUntil)
        return
      retryAfter.delete(key)
    }
    setStatus(room.id, 'connecting')
    try {
      const response = await bridgeRequest(`${UNIBARRAGE_API_PREFIX}/${room.platform}`, {
        method: 'POST',
        body: JSON.stringify({ rid: room.roomId }),
      })
      const payload = await response.json().catch(() => undefined) as UniBarrageBridgeResponse | undefined
      if (!response.ok) {
        // UniBarrage answers 400 with "已在监听中" when the listener is still
        // alive from a previous run; verify via GET before treating it as a
        // real rejection so app restarts do not wedge the room in `error`.
        if (payload?.code === 400 && await bridgeExists(room.platform, room.roomId) === true) {
          registered.set(key, room.id)
          setStatus(room.id, wsOpen ? 'connected' : 'connecting')
          return
        }
        throw new Error(`UniBarrage rejected room ${room.roomId}: ${response.status} ${payload?.message ?? ''}`.trim())
      }
      registered.set(key, room.id)
      setStatus(room.id, wsOpen ? 'connected' : 'connecting')
    }
    catch (error) {
      registered.delete(key)
      setStatus(room.id, 'error', errorMessageFrom(error) ?? `Failed to register ${room.platform} room`)
      log.withFields({ platform: room.platform, roomId: room.roomId }).withError(error).warn('failed to register room with UniBarrage')
    }
  }

  async function unregisterRoom(key: string, platform: LiveRoomPlatform, roomId: string) {
    const roomConfigId = registered.get(key)
    if (roomConfigId == null)
      return
    registered.delete(key)
    retryAfter.delete(key)
    try {
      await bridgeRequest(`${UNIBARRAGE_API_PREFIX}/${platform}/${roomId}`, { method: 'DELETE' })
    }
    catch (error) {
      log.withError(error).debug('failed to unregister room from UniBarrage')
    }
    setStatus(roomConfigId, 'stopped')
  }

  function applyBridgeStatus(state: LiveRoomStatus['state'], error?: string) {
    for (const room of activeRooms()) {
      // Only rooms whose HTTP registration succeeded can be "connected";
      // unregistered rooms stay in their previous (connecting/error) state.
      if (state === 'connected' && !registered.has(roomKey(room.platform, room.roomId)))
        continue
      setStatus(room.id, state, error)
    }
  }

  function openWebSocket() {
    const bridge = params.getBridge()
    if (!bridge?.url) {
      applyBridgeStatus('error', 'UniBarrage bridge is not running')
      return
    }
    if (stopped || ws || reconnectTimer)
      return

    let socket: WebSocket
    try {
      socket = new WebSocket(unibarrageWsUrl(bridge.url))
    }
    catch (error) {
      log.withError(error).warn('failed to open UniBarrage WebSocket')
      applyBridgeStatus('error', errorMessageFrom(error) ?? 'Invalid UniBarrage WebSocket url')
      return
    }
    ws = socket

    socket.addEventListener('open', () => {
      wsOpen = true
      applyBridgeStatus('connected')
      // Rooms whose registration failed while UniBarrage was down get another
      // chance now that the push socket is up; otherwise they stay in `error`
      // forever and no messages are ever delivered.
      for (const room of activeRooms()) {
        if (!registered.has(roomKey(room.platform, room.roomId)))
          void registerRoom(room)
      }
    })
    socket.addEventListener('message', (event) => {
      try {
        // Node's native WebSocket delivers text frames as strings and binary
        // frames as ArrayBuffer; UniBarrage pushes JSON text frames.
        const raw = typeof event.data === 'string'
          ? event.data
          : event.data instanceof ArrayBuffer
            ? new TextDecoder().decode(event.data)
            : String(event.data)
        const payload = JSON.parse(raw) as Parameters<typeof mapUniBarrageMessage>[0]
        // The root path already filters by platform; keep the explicit checks
        // so a misconfigured url cannot caption rooms this connector never
        // registered or platforms it does not consume.
        const platform = payload.platform ?? payload.data?.platform
        if (platform !== 'bilibili' && platform !== 'douyin')
          return
        if (payload.rid == null || !activeRooms().some(room => room.platform === platform && String(room.roomId) === String(payload.rid)))
          return
        const message = mapUniBarrageMessage(payload)
        if (message)
          params.onMessage(message)
      }
      catch (error) {
        log.withError(error).debug('failed to parse UniBarrage message')
      }
    })
    socket.addEventListener('close', () => {
      const wasOpen = wsOpen
      wsOpen = false
      ws = undefined
      // Only downgrade rooms that had a live push socket (the bridge may be
      // restarting). When the socket never opened, a registration failure
      // already surfaced as `error` and must not be masked by `connecting`.
      if (wasOpen)
        applyBridgeStatus('connecting')
      // stop() closes the socket and must not be followed by a reconnect.
      if (stopped)
        return
      // The bridge may be restarted; retry with a fixed backoff.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined
        openWebSocket()
      }, RECONNECT_DELAY_MS)
    })
    socket.addEventListener('error', () => {
      // close always follows; keep state transitioned there.
    })
  }

  function reconcile() {
    // Re-open the push socket when the bridge was down at startup but has come
    // up since; otherwise rooms would stay `error` until the next sync().
    if (!ws && !reconnectTimer)
      openWebSocket()
    // Register rooms that are still missing (UniBarrage came up late, or an
    // earlier registration was transiently rejected).
    for (const room of activeRooms()) {
      const key = roomKey(room.platform, room.roomId)
      if (!registered.has(key))
        void registerRoom(room)
    }
    // UniBarrage removes a room from its service list when the platform
    // listener dies; surface that instead of staying `connected` forever.
    for (const [key, configId] of registered) {
      const separatorIndex = key.indexOf(':')
      const platform = key.slice(0, separatorIndex) as LiveRoomPlatform
      const roomId = key.slice(separatorIndex + 1)
      void bridgeExists(platform, roomId).then((alive) => {
        if (alive !== false)
          return
        registered.delete(key)
        setStatus(configId, 'error', 'UniBarrage dropped the room (listener failed)')
        retryAfter.set(key, Date.now() + FAILED_RETRY_COOLDOWN_MS)
        log.withFields({ platform, roomId }).warn('UniBarrage dropped room; listener failed')
      })
    }
    if (activeRooms().length === 0 && registered.size === 0) {
      if (reconcileTimer) {
        clearInterval(reconcileTimer)
        reconcileTimer = undefined
      }
    }
  }

  function startReconcile() {
    if (reconcileTimer)
      return
    reconcileTimer = setInterval(reconcile, RECONCILE_INTERVAL_MS)
  }

  return {
    sync() {
      stopped = false
      const active = activeRooms()
      const activeKeys = new Set(active.map(room => roomKey(room.platform, room.roomId)))

      for (const key of [...registered.keys()]) {
        if (!activeKeys.has(key)) {
          const separatorIndex = key.indexOf(':')
          const platform = key.slice(0, separatorIndex) as LiveRoomPlatform
          const roomId = key.slice(separatorIndex + 1)
          void unregisterRoom(key, platform, roomId)
        }
      }
      for (const room of active) {
        const key = roomKey(room.platform, room.roomId)
        if (!registered.has(key))
          void registerRoom(room)
      }

      openWebSocket()
      startReconcile()
    },

    stop() {
      stopped = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      if (reconcileTimer) {
        clearInterval(reconcileTimer)
        reconcileTimer = undefined
      }
      for (const key of [...registered.keys()]) {
        const separatorIndex = key.indexOf(':')
        const platform = key.slice(0, separatorIndex) as LiveRoomPlatform
        const roomId = key.slice(separatorIndex + 1)
        void unregisterRoom(key, platform, roomId)
      }
      registered.clear()
      retryAfter.clear()
      wsOpen = false
      ws?.close()
      ws = undefined
      log.debug('unibarrage connector stopped')
    },
  }
}
