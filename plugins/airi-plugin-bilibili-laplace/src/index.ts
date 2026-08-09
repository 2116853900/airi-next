import type { Message, SuperChat } from '@laplace.live/event-types'
import type { WebSocketEventInputLiveChat } from '@proj-airi/server-sdk'

import { env } from 'node:process'

import { LaplaceEventBridgeClient } from '@laplace.live/event-bridge-sdk'
import { Client } from '@proj-airi/server-sdk'

export interface LiveChatBridgeOptions {
  laplaceUrl?: string
  laplaceToken?: string
  airiUrl?: string
  airiToken?: string
}

/**
 * Converts a LAPLACE chat event to the AIRI live-chat protocol payload.
 *
 * @example
 * toLiveChatMessage({ type: 'message', origin: 123, id: 'm1', username: 'Neko', message: 'Hello' })
 * // => { platform: 'bilibili', roomId: 123, messageId: 'm1', username: 'Neko', text: 'Hello' }
 */
export function toLiveChatMessage(event: Message | SuperChat): WebSocketEventInputLiveChat | undefined {
  const text = event.message.trim()
  if (!text || !event.username.trim())
    return undefined

  return {
    platform: 'bilibili',
    roomId: event.origin,
    messageId: event.type === 'superchat' ? `superchat:${event.id}` : event.id,
    username: event.username.trim(),
    text,
    avatar: 'avatar' in event && event.avatar ? event.avatar : undefined,
    color: event.type === 'superchat' ? event.messageColor : event.nameColor,
    timestamp: event.timestampNormalized,
  }
}

export function createLiveChatBridge(options: LiveChatBridgeOptions = {}) {
  const airiClient = new Client({
    name: 'proj-airi:plugin-bilibili-laplace',
    url: options.airiUrl ?? env.AIRI_SERVER_URL ?? 'ws://localhost:6121/ws',
    token: options.airiToken ?? env.AIRI_SERVER_TOKEN,
    possibleEvents: ['input:live-chat'],
    autoConnect: false,
  })
  const laplaceClient = new LaplaceEventBridgeClient({
    url: options.laplaceUrl ?? env.LAPLACE_EVENT_BRIDGE_URL ?? 'ws://localhost:9696',
    token: options.laplaceToken ?? env.LAPLACE_EVENT_BRIDGE_TOKEN,
    reconnect: true,
  })

  const seenMessageIds = new Set<string>()
  const forward = (event: Message | SuperChat) => {
    const message = toLiveChatMessage(event)
    if (!message || seenMessageIds.has(message.messageId))
      return

    seenMessageIds.add(message.messageId)
    if (seenMessageIds.size > 10_000) {
      const oldest = seenMessageIds.values().next().value
      if (oldest)
        seenMessageIds.delete(oldest)
    }

    if (!airiClient.send({ type: 'input:live-chat', data: message }))
      console.warn('[bilibili-laplace] AIRI server channel is not ready')
  }

  const removeMessageListener = laplaceClient.on('message', forward)
  const removeSuperChatListener = laplaceClient.on('superchat', forward)

  return {
    async start() {
      await airiClient.connect()
      await laplaceClient.connect()
    },
    stop() {
      removeMessageListener()
      removeSuperChatListener()
      laplaceClient.disconnect()
      airiClient.close()
      seenMessageIds.clear()
    },
  }
}
