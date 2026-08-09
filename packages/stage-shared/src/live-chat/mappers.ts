import type { WebSocketEventInputLiveChat } from '@proj-airi/server-sdk'

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

/** The platform shapes UniBarrage can push that the app consumes. */
type UniBarragePlatform = 'bilibili' | 'douyin'

/**
 * Maps a UniBarrage WebSocket message to the shared live-chat envelope.
 *
 * UniBarrage pushes `{ rid, platform, type, data: { name, avatar, content } }`
 * where the payload fields live under `data`; flat variants are accepted too.
 * The envelope `level` prefers the platform user level (`data.level`) and falls
 * back to the Bilibili fans-medal level (`data.medalLevel`) when it is absent.
 * Returns null for unsupported platforms/message types or unparseable payloads.
 *
 * @example
 * mapUniBarrageMessage({ rid: '123456', platform: 'douyin', type: 'Chat', data: { name: 'Neko', avatar: 'a.png', content: '你好', level: 25 } })
 * // => { platform: 'douyin', roomId: 123456, messageId: 'douyin:123456:…', username: 'Neko', text: '你好', avatar: 'a.png', level: 25 }
 */
export function mapUniBarrageMessage(msg: {
  rid?: string | number
  platform?: string
  type?: string
  name?: string
  avatar?: string
  content?: string
  price?: number
  level?: number
  medalLevel?: number
  data?: Record<string, unknown>
}): WebSocketEventInputLiveChat | null {
  const platform = msg.platform ?? msg.data?.platform
  if (platform && platform !== 'bilibili' && platform !== 'douyin')
    return null

  const type = msg.type ?? msg.data?.type
  if (type !== 'Chat' && type !== 'SuperChat')
    return null

  const rid = Number(msg.rid ?? msg.data?.rid)
  if (!Number.isFinite(rid) || rid <= 0)
    return null

  const name = msg.name ?? msg.data?.name
  const avatar = msg.avatar ?? msg.data?.avatar
  const content = msg.content ?? msg.data?.content
  if (typeof name !== 'string' || typeof content !== 'string' || !name.trim() || !content.trim())
    return null

  const price = typeof msg.price === 'number' ? msg.price : Number(msg.data?.price ?? 0)
  // User level, then fans-medal level as the display fallback (Bilibili only).
  const level = typeof msg.level === 'number'
    ? msg.level
    : typeof msg.data?.level === 'number'
      ? msg.data.level
      : typeof msg.data?.user_level === 'number'
        ? msg.data.user_level
        : undefined
  const medalLevel = typeof msg.medalLevel === 'number'
    ? msg.medalLevel
    : typeof msg.data?.medalLevel === 'number'
      ? msg.data.medalLevel
      : typeof msg.data?.medal_level === 'number'
        ? msg.data.medal_level
        : undefined

  const resolvedPlatform: UniBarragePlatform = platform === 'bilibili' ? 'bilibili' : 'douyin'

  return {
    platform: resolvedPlatform,
    roomId: rid,
    messageId: `${resolvedPlatform}:${rid}:${nowSeconds()}:${Math.random().toString(36).slice(2, 8)}`,
    username: name.trim(),
    text: content.trim(),
    avatar: typeof avatar === 'string' ? avatar : undefined,
    color: type === 'SuperChat' ? superChatColor(price) : undefined,
    level: level ?? medalLevel,
    timestamp: nowSeconds(),
  }
}

/** Price tier to highlight color for super chats (matches the Bilibili gradient scale). */
export function superChatColor(price: number): string {
  if (price >= 100)
    return '#ef4444'
  if (price >= 50)
    return '#f97316'
  if (price >= 30)
    return '#f59e0b'
  if (price >= 10)
    return '#10b981'
  return '#3b82f6'
}
