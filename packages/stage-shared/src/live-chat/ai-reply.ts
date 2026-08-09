import type { WebSocketEventInputLiveChat } from '@proj-airi/server-sdk'

export type LiveChatAiReplyTrigger = 'mention' | 'all'

export type LiveChatAiReplyReason
  = | 'disabled'
    | 'empty'
    | 'too-long'
    | 'trigger-miss'
    | 'duplicate'
    | 'cooldown'

/** Plain moderation context so `evaluateLiveChatReply` stays store-free. */
export interface LiveChatAiReplyContext {
  enabled: boolean
  trigger: LiveChatAiReplyTrigger
  /** Active character card name, matched as a case-insensitive substring. */
  characterName: string
  /** Extra trigger keywords besides the character name. */
  triggerKeywords: string[]
  /** Minimum gap between two accepted replies, in epoch ms. */
  cooldownMs: number
  includeSender: boolean
  /** Danmaku longer than this many characters is ignored. */
  maxLength: number
  /** Timestamp of the last accepted reply, in epoch ms. */
  lastReplyAt: number
  /** Current time, in epoch ms. */
  now: number
  /** Whether this message id was already seen within the dedupe window. */
  isDuplicate: boolean
}

export type LiveChatAiReplyDecision
  = | { ok: true, text: string }
    | { ok: false, reason: LiveChatAiReplyReason }

/**
 * Decides whether one danmaku should trigger an AI reply and, if so, which
 * text to ingest. Pure: callers pass a plain context snapshot.
 *
 * @example
 * evaluateLiveChatReply({ platform: 'bilibili', roomId: 1, messageId: 'm1', username: 'Neko', text: '@ReLU 你好' }, { ...ctx, enabled: true, trigger: 'mention', characterName: 'ReLU' })
 * // => { ok: true, text: 'Neko: @ReLU 你好' }
 */
export function evaluateLiveChatReply(
  message: WebSocketEventInputLiveChat,
  ctx: LiveChatAiReplyContext,
): LiveChatAiReplyDecision {
  const text = message.text.trim()
  if (!ctx.enabled)
    return { ok: false, reason: 'disabled' }
  if (!text)
    return { ok: false, reason: 'empty' }
  if (text.length > ctx.maxLength)
    return { ok: false, reason: 'too-long' }
  if (ctx.trigger === 'mention' && !matchesMention(text, ctx.characterName, ctx.triggerKeywords))
    return { ok: false, reason: 'trigger-miss' }
  if (ctx.isDuplicate)
    return { ok: false, reason: 'duplicate' }
  if (ctx.now - ctx.lastReplyAt < ctx.cooldownMs)
    return { ok: false, reason: 'cooldown' }

  return {
    ok: true,
    text: formatLiveChatIngestText(message, { includeSender: ctx.includeSender }),
  }
}

/**
 * Matches a mention trigger against a danmaku.
 *
 * Substring matching is intentional: Chinese danmaku has no word boundaries,
 * so token-based matching would miss a bare character name. A one-character
 * name needs the `@` prefix, otherwise it would match most of the chat.
 *
 * @example
 * matchesMention('@ReLU 早上好', 'ReLU', [])
 * // => true
 */
export function matchesMention(text: string, characterName: string, triggerKeywords: string[]): boolean {
  const haystack = text.toLowerCase()
  const name = characterName.trim()
  const candidates = [
    ...(name.length > 1 ? [name] : []),
    name ? `@${name}` : '',
    ...triggerKeywords.map(keyword => keyword.trim()).filter(keyword => keyword.length > 1),
  ]

  return candidates.some(keyword => keyword && haystack.includes(keyword.toLowerCase()))
}

/**
 * Prepares the text that is ingested into the chat session.
 *
 * @example
 * formatLiveChatIngestText({ platform: 'bilibili', roomId: 1, messageId: 'm1', username: 'Neko', text: '你好' }, { includeSender: true })
 * // => 'Neko: 你好'
 */
export function formatLiveChatIngestText(
  message: WebSocketEventInputLiveChat,
  options: { includeSender: boolean },
): string {
  const text = message.text.trim()
  const username = message.username?.trim()
  if (!options.includeSender || !username)
    return text
  return `${username}: ${text}`
}
