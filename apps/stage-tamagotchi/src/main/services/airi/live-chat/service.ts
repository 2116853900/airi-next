import type { WebSocketEventInputLiveChat } from '@proj-airi/server-sdk'
import type { LiveRoomConfig, LiveRoomPlatform, LiveRoomStatus, UniBarrageBridgeConfig } from '@proj-airi/stage-shared/live-chat'

import type { LiveRoomConnector } from './connector'

import { randomUUID } from 'node:crypto'
import { env } from 'node:process'

import { useLogg } from '@guiiai/logg'
import { Client } from '@proj-airi/server-sdk'

import { getChannelServerAuthToken } from '../channel-server'
import { createLiveChatConfigStore } from './config'
import { createUniBarrageConnector } from './unibarrage-connector'

export interface LiveChatService {
  listRooms: () => LiveRoomConfig[]
  addRoom: (input: { platform: LiveRoomPlatform, roomId: string }) => LiveRoomConfig
  removeRoom: (id: string) => void
  updateRoom: (id: string, patch: Partial<Pick<LiveRoomConfig, 'roomId'>>) => LiveRoomConfig
  setEnabled: (id: string, enabled: boolean) => LiveRoomConfig
  getStatus: () => Record<string, LiveRoomStatus>
  subscribeStatus: (listener: (status: Record<string, LiveRoomStatus>) => void) => () => void
  start: () => void
  stop: () => void
}

function getServerChannelPort() {
  return env.SERVER_CHANNEL_PORT ? Number.parseInt(env.SERVER_CHANNEL_PORT) : 6121
}

/**
 * Owns the in-app live-room connector (Bilibili + Douyin via the managed
 * UniBarrage sidecar) and forwards chat messages into the local server channel
 * so existing renderer plumbing (App.vue -> caption overlay BroadcastChannel)
 * receives them unchanged.
 *
 * Call stack:
 *
 * setupLiveChatService
 *   -> {@link createUniBarrageConnector} (managed UniBarrage bridge)
 *     -> server-sdk {@link Client} (local server channel)
 *       -> renderer serverChannelStore -> caption overlay
 */
export function setupLiveChatService(params: {
  getBridge: () => UniBarrageBridgeConfig | undefined
}): LiveChatService {
  const log = useLogg('main/live-chat').useGlobalConfig()
  const configStore = createLiveChatConfigStore()
  const statusByRoom = new Map<string, LiveRoomStatus>()
  const statusListeners = new Set<(status: Record<string, LiveRoomStatus>) => void>()
  let client: Client | undefined
  let started = false

  const connector: LiveRoomConnector = createUniBarrageConnector({
    getBridge: params.getBridge,
    getRooms: () => configStore.get().rooms,
    onMessage: message => publish(message),
    onStatus: (roomId, status) => setRoomStatus(roomId, status),
  })

  function setRoomStatus(roomId: string, status: LiveRoomStatus) {
    statusByRoom.set(roomId, status)
    const snapshot = Object.fromEntries(statusByRoom)
    for (const listener of statusListeners) {
      try {
        listener(snapshot)
      }
      catch (error) {
        log.withError(error).warn('failed to publish live-chat status change')
      }
    }
  }

  function ensureClient() {
    if (client)
      return client

    const next = new Client({
      name: 'proj-airi:stage-tamagotchi',
      url: `ws://127.0.0.1:${getServerChannelPort()}/ws`,
      token: getChannelServerAuthToken(),
      possibleEvents: ['input:live-chat'],
      autoConnect: false,
      autoReconnect: true,
      onError: error => log.withError(error).warn('live-chat server channel client error'),
    })
    client = next
    void next.connect().catch(error => log.withError(error).debug('live-chat server channel connect failed'))
    return next
  }

  function publish(message: WebSocketEventInputLiveChat) {
    const sent = ensureClient().send({ type: 'input:live-chat', data: message })
    // The channel may be starting up or the auth token out of date; the
    // danmaku socket stays healthy, so the room status is left untouched.
    if (!sent)
      log.withFields({ platform: message.platform, roomId: message.roomId }).debug('dropped live-chat message (server channel not ready)')
  }

  function syncConnector() {
    if (started)
      connector.sync()
  }

  return {
    listRooms() {
      return configStore.get().rooms
    },

    addRoom(input) {
      const room: LiveRoomConfig = {
        id: randomUUID(),
        platform: input.platform,
        roomId: input.roomId.trim(),
        enabled: true,
      }
      const rooms = [...configStore.get().rooms, room]
      configStore.updateRooms(rooms)
      syncConnector()
      return room
    },

    removeRoom(id) {
      const rooms = configStore.get().rooms.filter(room => room.id !== id)
      configStore.updateRooms(rooms)
      statusByRoom.delete(id)
      syncConnector()
    },

    updateRoom(id, patch) {
      const rooms = configStore.get().rooms.map(room => room.id === id ? { ...room, ...patch } : room)
      configStore.updateRooms(rooms)
      syncConnector()
      return rooms.find(room => room.id === id) ?? configStore.get().rooms[0]
    },

    setEnabled(id, enabled) {
      const rooms = configStore.get().rooms.map(room => room.id === id ? { ...room, enabled } : room)
      configStore.updateRooms(rooms)
      syncConnector()
      return rooms.find(room => room.id === id) ?? configStore.get().rooms[0]
    },

    getStatus() {
      return Object.fromEntries(statusByRoom)
    },

    subscribeStatus(listener) {
      statusListeners.add(listener)
      listener(Object.fromEntries(statusByRoom))
      return () => {
        statusListeners.delete(listener)
      }
    },

    start() {
      if (started)
        return
      started = true
      connector.sync()
    },

    stop() {
      if (!started)
        return
      started = false
      connector.stop()
      client?.close()
      client = undefined
      statusByRoom.clear()
    },
  }
}
