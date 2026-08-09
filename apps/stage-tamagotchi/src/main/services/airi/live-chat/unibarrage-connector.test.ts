import type { LiveRoomConfig, UniBarrageBridgeConfig } from '@proj-airi/stage-shared/live-chat'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createUniBarrageConnector, unibarrageWsUrl } from './unibarrage-connector'

const fetchMock = vi.fn()

function chainableLog() {
  let proxy: any
  const fn = (..._args: unknown[]) => proxy
  proxy = new Proxy(fn, {
    get: (_target, prop) => {
      // Let the runtime coerce/inspect the mock instead of returning a callable.
      if (prop === Symbol.toPrimitive || prop === 'then')
        return undefined
      return proxy
    },
  })
  return proxy
}

vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({ useGlobalConfig: () => chainableLog() }),
}))

/** Minimal stand-in for the global WebSocket the connector dials. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  url: string
  closed = false
  private listeners = new Map<string, Array<(event?: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event?: unknown) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(event)
  }

  emitOpen() {
    this.emit('open')
  }

  emitMessage(data: unknown) {
    this.emit('message', { data })
  }

  emitClose() {
    this.closed = true
    this.emit('close')
  }

  close() {
    if (this.closed)
      return
    this.closed = true
    this.emit('close')
  }

  static last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  }

  static reset() {
    FakeWebSocket.instances = []
  }
}

const API = 'http://127.0.0.1:8080/api/v1'
const WS = 'ws://127.0.0.1:7777'

function okResponse(body?: unknown): Response {
  return { ok: true, status: 200, json: async () => body ?? { code: 200 } } as unknown as Response
}

function errResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response
}

function setupFetch(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${String(input)}`
    const route = routes[key] ?? routes['*']
    if (!route)
      throw new Error(`unexpected fetch: ${method} ${String(input)}`)
    return route()
  })
}

function room(overrides: Partial<LiveRoomConfig> = {}): LiveRoomConfig {
  return { id: 'room-1', platform: 'douyin', roomId: '123', enabled: true, ...overrides }
}

function setup(overrides: { rooms?: LiveRoomConfig[], bridge?: UniBarrageBridgeConfig | undefined } = {}) {
  const rooms = overrides.rooms ?? [room()]
  const bridge = overrides.bridge ?? { url: WS, apiUrl: 'http://127.0.0.1:8080', token: '' }
  const getRooms = vi.fn(() => rooms)
  const getBridge = vi.fn(() => bridge)
  const onMessage = vi.fn()
  const onStatus = vi.fn()
  const connector = createUniBarrageConnector({ getBridge, getRooms, onMessage, onStatus })
  return { connector, getRooms, getBridge, onMessage, onStatus, rooms, bridge }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('unibarrageWsUrl', () => {
  it('keeps a bare or trailing-slash url on the root filter path', () => {
    expect(unibarrageWsUrl('ws://127.0.0.1:7777')).toBe('ws://127.0.0.1:7777')
    expect(unibarrageWsUrl('ws://127.0.0.1:7777/')).toBe('ws://127.0.0.1:7777')
  })

  it('strips a platform filter path so one socket receives all platforms', () => {
    expect(unibarrageWsUrl('ws://127.0.0.1:7777/douyin')).toBe('ws://127.0.0.1:7777')
  })

  it('leaves an unparseable url untouched', () => {
    expect(unibarrageWsUrl('not a url')).toBe('not a url')
  })
})

describe('createUniBarrageConnector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.reset()
    fetchMock.mockReset()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('registers enabled douyin + bilibili rooms and subscribes to the root socket', async () => {
    const rooms = [
      room(),
      room({ id: 'room-2', platform: 'bilibili', roomId: '6' }),
    ]
    const { connector, onStatus, onMessage } = setup({ rooms })
    setupFetch({
      [`POST ${API}/douyin`]: () => okResponse({ code: 201 }),
      [`POST ${API}/bilibili`]: () => okResponse({ code: 201 }),
    })

    connector.sync()
    await flush()

    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/douyin`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ rid: '123' }) }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `${API}/bilibili`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ rid: '6' }) }),
    )
    expect(FakeWebSocket.last().url).toBe(WS)
    expect(onStatus).toHaveBeenCalledWith('room-1', expect.objectContaining({ state: 'connecting' }))

    FakeWebSocket.last().emitOpen()
    await flush()
    expect(onStatus).toHaveBeenCalledWith('room-1', expect.objectContaining({ state: 'connected' }))
    expect(onStatus).toHaveBeenCalledWith('room-2', expect.objectContaining({ state: 'connected' }))
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('skips disabled rooms and other platforms', async () => {
    const rooms = [
      room({ enabled: false }),
      room({ id: 'room-3', platform: 'douyin', roomId: '999', enabled: false }),
      room({ id: 'room-4', platform: 'kuaishou' as unknown as LiveRoomConfig['platform'], roomId: '1', enabled: true }),
    ]
    const { connector, onStatus } = setup({ rooms })

    connector.sync()
    await flush()

    expect(onStatus).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(FakeWebSocket.last()).toBeDefined()
  })

  it('re-registers rooms when the WebSocket opens after the bridge came up late', async () => {
    const { connector, onStatus } = setup()
    // Bridge unreachable at startup: registration fails.
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    connector.sync()
    await flush()
    expect(onStatus).toHaveBeenLastCalledWith('room-1', expect.objectContaining({ state: 'error' }))

    // Bridge comes up; the ws open re-runs registration.
    setupFetch({ [`POST ${API}/douyin`]: () => okResponse({ code: 201 }) })
    FakeWebSocket.last().emitOpen()
    await flush()

    const posts = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/douyin') && (init as RequestInit | undefined)?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(onStatus).toHaveBeenLastCalledWith('room-1', expect.objectContaining({ state: 'connected' }))
  })

  it('re-opens the socket from the reconcile tick when the bridge was down at sync', async () => {
    const holder = { bridge: undefined as UniBarrageBridgeConfig | undefined }
    const getRooms = vi.fn(() => [room()])
    const getBridge = vi.fn(() => holder.bridge)
    const connector = createUniBarrageConnector({ getBridge, getRooms, onMessage: vi.fn(), onStatus: vi.fn() })

    connector.sync()
    await flush()
    // No bridge -> no socket; the sync still attempts registration, which fails.
    expect(FakeWebSocket.instances).toHaveLength(0)

    // Bridge comes up; the reconcile tick dials it.
    holder.bridge = { url: WS, apiUrl: 'http://127.0.0.1:8080', token: '' }
    setupFetch({ [`POST ${API}/douyin`]: () => okResponse({ code: 201 }) })
    await vi.advanceTimersByTimeAsync(10_000) // reconcile tick
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('treats an already-running UniBarrage room as registered', async () => {
    const { connector, onStatus } = setup()
    setupFetch({
      [`POST ${API}/douyin`]: () => errResponse(400, { code: 400, message: '已在监听中' }),
      [`GET ${API}/douyin/123`]: () => okResponse({ code: 200 }),
    })

    connector.sync()
    await flush()
    expect(onStatus).toHaveBeenLastCalledWith('room-1', expect.objectContaining({ state: 'connecting' }))

    FakeWebSocket.last().emitOpen()
    await flush()
    expect(onStatus).toHaveBeenLastCalledWith('room-1', expect.objectContaining({ state: 'connected' }))
    expect(onStatus.mock.calls.filter(([, s]) => s.state === 'error')).toHaveLength(0)
  })

  it('surfaces an error when UniBarrage rejects a room outright', async () => {
    const { connector, onStatus } = setup()
    setupFetch({
      [`POST ${API}/douyin`]: () => errResponse(400, { code: 400, message: '已在监听中' }),
      [`GET ${API}/douyin/123`]: () => errResponse(404, { code: 404 }),
    })

    connector.sync()
    await flush()

    expect(onStatus).toHaveBeenLastCalledWith('room-1', expect.objectContaining({ state: 'error' }))
  })

  it('forwards chat messages for active rooms of both platforms with level', async () => {
    const rooms = [room(), room({ id: 'room-2', platform: 'bilibili', roomId: '6' })]
    const { connector, onMessage } = setup({ rooms })
    setupFetch({
      [`POST ${API}/douyin`]: () => okResponse({ code: 201 }),
      [`POST ${API}/bilibili`]: () => okResponse({ code: 201 }),
    })

    connector.sync()
    await flush()
    FakeWebSocket.last().emitOpen()
    await flush()

    FakeWebSocket.last().emitMessage(JSON.stringify({ rid: '123', platform: 'douyin', type: 'Chat', data: { name: 'Neko', content: '你好', level: 25 } }))
    FakeWebSocket.last().emitMessage(JSON.stringify({ rid: '6', platform: 'bilibili', type: 'Chat', data: { name: 'Airi', content: 'hello', level: 6, medalLevel: 30 } }))
    FakeWebSocket.last().emitMessage(JSON.stringify({ rid: '6', platform: 'bilibili', type: 'Chat', name: 'Airi', content: 'medal only', medalLevel: 30 }))
    FakeWebSocket.last().emitMessage(JSON.stringify({ rid: '789', platform: 'douyin', type: 'Chat', name: 'Ghost', content: 'not ours' }))
    FakeWebSocket.last().emitMessage(JSON.stringify({ rid: '6', type: 'Gift', name: 'Airi', content: 'rocket' }))

    expect(onMessage).toHaveBeenCalledTimes(3)
    expect(onMessage.mock.calls[0][0]).toEqual(expect.objectContaining({ platform: 'douyin', roomId: 123, username: 'Neko', text: '你好', level: 25 }))
    expect(onMessage.mock.calls[1][0]).toEqual(expect.objectContaining({ platform: 'bilibili', roomId: 6, username: 'Airi', text: 'hello', level: 6 }))
    expect(onMessage.mock.calls[2][0]).toEqual(expect.objectContaining({ platform: 'bilibili', roomId: 6, username: 'Airi', text: 'medal only', level: 30 }))
  })

  it('flags rooms UniBarrage silently dropped and re-registers after the cooldown', async () => {
    const { connector, onStatus } = setup()
    setupFetch({
      [`POST ${API}/douyin`]: () => okResponse({ code: 201 }),
      [`GET ${API}/douyin/123`]: () => okResponse({ code: 200 }),
    })

    connector.sync()
    await flush()
    FakeWebSocket.last().emitOpen()
    await flush()
    expect(onStatus).toHaveBeenLastCalledWith('room-1', expect.objectContaining({ state: 'connected' }))

    // The Douyin listener dies; UniBarrage no longer lists the room.
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/douyin') && init?.method === 'POST')
        return okResponse({ code: 201 })
      if (String(url).endsWith('/api/v1/douyin/123'))
        return errResponse(404, { code: 404 })
      throw new Error(`unexpected fetch: ${init?.method} ${String(url)}`)
    })
    await vi.advanceTimersByTimeAsync(10_000) // reconcile tick
    expect(onStatus).toHaveBeenLastCalledWith('room-1', expect.objectContaining({ state: 'error' }))

    // The listener recovers; after the retry cooldown a later tick re-registers
    // and the room stays connected.
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/api/v1/douyin') && init?.method === 'POST')
        return okResponse({ code: 201 })
      if (String(url).endsWith('/api/v1/douyin/123'))
        return okResponse({ code: 200 })
      throw new Error(`unexpected fetch: ${init?.method} ${String(url)}`)
    })
    await vi.advanceTimersByTimeAsync(60_000)
    const posts = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/douyin') && (init as RequestInit | undefined)?.method === 'POST')
    expect(posts.length).toBeGreaterThan(1)
    expect(onStatus).toHaveBeenLastCalledWith('room-1', expect.objectContaining({ state: 'connected' }))
  })

  it('reconnects the socket after a close', async () => {
    const { connector } = setup()
    setupFetch({ [`POST ${API}/douyin`]: () => okResponse({ code: 201 }) })

    connector.sync()
    await flush()
    expect(FakeWebSocket.instances).toHaveLength(1)

    FakeWebSocket.last().emitClose()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(FakeWebSocket.instances).toHaveLength(2)

    FakeWebSocket.last().emitOpen()
    await flush()
  })

  it('stop() unregisters rooms, closes the socket, and does not reconnect', async () => {
    const { connector } = setup()
    setupFetch({
      [`POST ${API}/douyin`]: () => okResponse({ code: 201 }),
      [`DELETE ${API}/douyin/123`]: () => okResponse({ code: 200 }),
    })

    connector.sync()
    await flush()

    connector.stop()
    await flush()
    FakeWebSocket.last().emitClose()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(fetchMock).toHaveBeenCalledWith(`${API}/douyin/123`, expect.objectContaining({ method: 'DELETE' }))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
