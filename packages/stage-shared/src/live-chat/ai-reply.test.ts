import type { WebSocketEventInputLiveChat } from '@proj-airi/server-sdk'

import type { LiveChatAiReplyContext } from './ai-reply'

import { describe, expect, it } from 'vitest'

import { evaluateLiveChatReply, formatLiveChatIngestText, matchesMention } from './ai-reply'

function message(overrides: Partial<WebSocketEventInputLiveChat> = {}): WebSocketEventInputLiveChat {
  return {
    platform: 'bilibili',
    roomId: 6,
    messageId: 'm1',
    username: 'Neko',
    text: '你好',
    ...overrides,
  }
}

function context(overrides: Partial<LiveChatAiReplyContext> = {}): LiveChatAiReplyContext {
  return {
    enabled: true,
    trigger: 'mention',
    characterName: 'ReLU',
    triggerKeywords: [],
    cooldownMs: 15_000,
    includeSender: true,
    maxLength: 120,
    lastReplyAt: 0,
    now: 100_000,
    isDuplicate: false,
    ...overrides,
  }
}

describe('evaluateLiveChatReply', () => {
  it('skips when AI reply is disabled', () => {
    expect(evaluateLiveChatReply(message(), context({ enabled: false }))).toEqual({ ok: false, reason: 'disabled' })
  })

  it('skips empty or whitespace-only danmaku', () => {
    expect(evaluateLiveChatReply(message({ text: '   ' }), context())).toEqual({ ok: false, reason: 'empty' })
  })

  it('skips danmaku longer than the configured max length', () => {
    const text = '长'.repeat(121)
    expect(evaluateLiveChatReply(message({ text }), context({ maxLength: 120 }))).toEqual({ ok: false, reason: 'too-long' })
  })

  it('accepts a danmaku of exactly the max length', () => {
    const text = '长'.repeat(120)
    expect(evaluateLiveChatReply(message({ text }), context({ trigger: 'all', maxLength: 120 })).ok).toBe(true)
  })

  it('skips non-mention danmaku in mention mode', () => {
    expect(evaluateLiveChatReply(message({ text: '主播好可爱' }), context())).toEqual({ ok: false, reason: 'trigger-miss' })
  })

  it('accepts a danmaku that mentions the character name', () => {
    expect(evaluateLiveChatReply(message({ text: 'ReLU 早上好' }), context())).toEqual({
      ok: true,
      text: 'Neko: ReLU 早上好',
    })
  })

  it('accepts a danmaku that mentions the character with an @ prefix', () => {
    expect(evaluateLiveChatReply(message({ text: '@ReLU 晚上好' }), context())).toEqual({
      ok: true,
      text: 'Neko: @ReLU 晚上好',
    })
  })

  it('accepts a danmaku that matches a custom trigger keyword', () => {
    expect(evaluateLiveChatReply(message({ text: '空降成功' }), context({ triggerKeywords: ['空降'] })).ok).toBe(true)
  })

  it('accepts every danmaku in all mode', () => {
    expect(evaluateLiveChatReply(message({ text: '随便聊聊' }), context({ trigger: 'all' })).ok).toBe(true)
  })

  it('skips a duplicate message id within the dedupe window', () => {
    expect(evaluateLiveChatReply(message(), context({ trigger: 'all', isDuplicate: true }))).toEqual({ ok: false, reason: 'duplicate' })
  })

  it('skips when inside the cooldown window', () => {
    const now = 100_000
    expect(evaluateLiveChatReply(message(), context({ trigger: 'all', lastReplyAt: now - 1_000, now }))).toEqual({ ok: false, reason: 'cooldown' })
  })

  it('accepts when the cooldown window has elapsed', () => {
    const now = 100_000
    expect(evaluateLiveChatReply(message(), context({ trigger: 'all', lastReplyAt: now - 15_000, now })).ok).toBe(true)
  })

  it('omits the sender name when includeSender is disabled', () => {
    expect(evaluateLiveChatReply(message({ text: 'ReLU 在吗' }), context({ includeSender: false }))).toEqual({
      ok: true,
      text: 'ReLU 在吗',
    })
  })
})

describe('matchesMention', () => {
  it('matches the character name case-insensitively', () => {
    expect(matchesMention('relu 在吗', 'ReLU', [])).toBe(true)
  })

  it('matches the @name form', () => {
    expect(matchesMention('帮我 @Relu', 'ReLU', [])).toBe(true)
  })

  it('matches a custom trigger keyword', () => {
    expect(matchesMention('空降', 'ReLU', ['空降'])).toBe(true)
  })

  it('does not match a one-character name without the @ prefix', () => {
    expect(matchesMention('这个真好', '真', [])).toBe(false)
  })

  it('matches a one-character name with the @ prefix', () => {
    expect(matchesMention('@真 你好', '真', [])).toBe(true)
  })

  it('returns false when nothing matches', () => {
    expect(matchesMention('随便聊聊', 'ReLU', ['空降'])).toBe(false)
  })
})

describe('formatLiveChatIngestText', () => {
  it('prefixes the sender name when requested', () => {
    expect(formatLiveChatIngestText(message(), { includeSender: true })).toBe('Neko: 你好')
  })

  it('returns the raw text when includeSender is disabled', () => {
    expect(formatLiveChatIngestText(message(), { includeSender: false })).toBe('你好')
  })

  it('returns the raw text when the sender is blank', () => {
    expect(formatLiveChatIngestText(message({ username: '  ' }), { includeSender: true })).toBe('你好')
  })

  it('trims the danmaku text', () => {
    expect(formatLiveChatIngestText(message({ text: '  你好  ' }), { includeSender: false })).toBe('你好')
  })
})
