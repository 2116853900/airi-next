import { describe, expect, it } from 'vitest'

import { shouldDisplayLiveChatMessage } from './dedupe'

const WINDOW_MS = 30_000
const MAX_REPEATS = 1

function track() {
  return new Map<string, number[]>()
}

describe('shouldDisplayLiveChatMessage', () => {
  it('displays the first occurrence of a text', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 1_000, WINDOW_MS, MAX_REPEATS)).toBe(true)
  })

  it('suppresses a repeat within the window', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 1_000, WINDOW_MS, MAX_REPEATS)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 5_000, WINDOW_MS, MAX_REPEATS)).toBe(false)
  })

  it('displays again after the window has elapsed', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 1_000, WINDOW_MS, MAX_REPEATS)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 5_000, WINDOW_MS, MAX_REPEATS)).toBe(false)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 40_000, WINDOW_MS, MAX_REPEATS)).toBe(true)
  })

  it('allows up to maxRepeats occurrences within the window', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈哈', 1_000, WINDOW_MS, 3)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈哈', 2_000, WINDOW_MS, 3)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈哈', 3_000, WINDOW_MS, 3)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈哈', 4_000, WINDOW_MS, 3)).toBe(false)
  })

  it('tracks different texts independently', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 1_000, WINDOW_MS, MAX_REPEATS)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '嘿嘿', 1_000, WINDOW_MS, MAX_REPEATS)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 2_000, WINDOW_MS, MAX_REPEATS)).toBe(false)
    expect(shouldDisplayLiveChatMessage(seenAt, '嘿嘿', 2_000, WINDOW_MS, MAX_REPEATS)).toBe(false)
  })

  it('treats whitespace-padded text as the same key', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 1_000, WINDOW_MS, MAX_REPEATS)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '  哈哈  ', 2_000, WINDOW_MS, MAX_REPEATS)).toBe(false)
  })

  it('always displays when the window is zero', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 1_000, 0, MAX_REPEATS)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 2_000, 0, MAX_REPEATS)).toBe(true)
  })

  it('always displays when maxRepeats is zero', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 1_000, WINDOW_MS, 0)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, '哈哈', 2_000, WINDOW_MS, 0)).toBe(true)
  })

  it('re-records a text whose occurrence aged out of the window', () => {
    const seenAt = track()
    expect(shouldDisplayLiveChatMessage(seenAt, 'stale', 0, WINDOW_MS, MAX_REPEATS)).toBe(true)
    expect(shouldDisplayLiveChatMessage(seenAt, 'stale', WINDOW_MS, WINDOW_MS, MAX_REPEATS)).toBe(true)
    expect(seenAt.get('stale')).toEqual([WINDOW_MS])
  })
})
