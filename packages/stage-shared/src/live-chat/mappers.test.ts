import { describe, expect, it } from 'vitest'

import { mapUniBarrageMessage, superChatColor } from './mappers'

describe('mapUniBarrageMessage', () => {
  it('maps a UniBarrage Chat message (douyin)', () => {
    const message = mapUniBarrageMessage({
      rid: '123456',
      platform: 'douyin',
      type: 'Chat',
      name: 'Neko',
      avatar: 'a.png',
      content: '你好',
    })

    expect(message).toEqual(expect.objectContaining({
      platform: 'douyin',
      roomId: 123_456,
      username: 'Neko',
      text: '你好',
      avatar: 'a.png',
    }))
    expect(message?.messageId).toMatch(/^douyin:123456:/)
  })

  it('maps a bilibili Chat message with user level', () => {
    const message = mapUniBarrageMessage({
      rid: '6',
      platform: 'bilibili',
      type: 'Chat',
      data: { name: 'Airi', content: 'hello', level: 6, medalLevel: 25 },
    })

    expect(message).toEqual(expect.objectContaining({
      platform: 'bilibili',
      roomId: 6,
      username: 'Airi',
      text: 'hello',
      level: 6,
    }))
    expect(message?.messageId).toMatch(/^bilibili:6:/)
  })

  it('falls back to the fans-medal level when user level is absent', () => {
    const message = mapUniBarrageMessage({
      rid: '6',
      platform: 'bilibili',
      type: 'Chat',
      data: { name: 'Airi', content: 'hello', medalLevel: 25 },
    })

    expect(message?.level).toBe(25)
  })

  it('reads chat fields from a nested data payload', () => {
    const message = mapUniBarrageMessage({
      rid: '123456',
      type: 'Chat',
      data: { name: 'Airi', content: 'hello' },
    })

    expect(message).toEqual(expect.objectContaining({ platform: 'douyin', username: 'Airi', text: 'hello' }))
  })

  it('colors SuperChat messages by price', () => {
    const message = mapUniBarrageMessage({ rid: '9', type: 'SuperChat', name: 'Neko', content: 'hi', price: 100 })

    expect(message?.color).toBe('#ef4444')
  })

  it('ignores non-chat message types', () => {
    expect(mapUniBarrageMessage({ rid: '123456', type: 'Gift', name: 'Neko', content: 'rocket' })).toBeNull()
    expect(mapUniBarrageMessage({ rid: '123456', type: 'Like', name: 'Neko' })).toBeNull()
  })

  it('ignores messages from other platforms', () => {
    expect(mapUniBarrageMessage({ rid: '123456', platform: 'kuaishou', type: 'Chat', name: 'Neko', content: 'hi' })).toBeNull()
    expect(mapUniBarrageMessage({ rid: '123456', platform: 'douyu', type: 'Chat', data: { name: 'Neko', content: 'hi' } })).toBeNull()
  })

  it('returns null for invalid room ids or empty content', () => {
    expect(mapUniBarrageMessage({ rid: 'abc', type: 'Chat', name: 'Neko', content: 'hi' })).toBeNull()
    expect(mapUniBarrageMessage({ rid: '123', type: 'Chat', name: 'Neko', content: '' })).toBeNull()
  })
})

describe('superChatColor', () => {
  it('scales by price tier', () => {
    expect(superChatColor(100)).toBe('#ef4444')
    expect(superChatColor(50)).toBe('#f97316')
    expect(superChatColor(30)).toBe('#f59e0b')
    expect(superChatColor(10)).toBe('#10b981')
    expect(superChatColor(1)).toBe('#3b82f6')
  })
})
