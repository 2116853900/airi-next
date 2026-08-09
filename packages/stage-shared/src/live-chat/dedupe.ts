/** Max unique danmaku texts kept in the dedupe tracker before stale entries are pruned. */
const MAX_TRACKED_TEXTS = 500

/**
 * Decides whether a danmaku text may be displayed, recording this occurrence.
 *
 * The same text may be shown at most `maxRepeats` times within any sliding
 * `windowMs` window; extra occurrences are suppressed. Each call trims
 * timestamps that fell out of the window, keeping per-text arrays bounded.
 * Pass `windowMs <= 0` or `maxRepeats <= 0` to disable repeat filtering.
 *
 * @example
 * const seenAt = new Map<string, number[]>()
 * shouldDisplayLiveChatMessage(seenAt, '哈哈', 1_000, 30_000, 1) // => true
 * shouldDisplayLiveChatMessage(seenAt, '哈哈', 5_000, 30_000, 1) // => false
 * shouldDisplayLiveChatMessage(seenAt, '哈哈', 40_000, 30_000, 1) // => true
 */
export function shouldDisplayLiveChatMessage(
  seenAt: Map<string, number[]>,
  text: string,
  now: number,
  windowMs: number,
  maxRepeats: number,
): boolean {
  if (windowMs <= 0 || maxRepeats <= 0)
    return true
  const key = text.trim()
  const recent = (seenAt.get(key) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= maxRepeats) {
    seenAt.set(key, recent)
    return false
  }
  recent.push(now)
  seenAt.set(key, recent)
  // Drop texts whose newest occurrence aged out of the window to keep the
  // tracker bounded over a long stream of unique danmaku.
  if (seenAt.size > MAX_TRACKED_TEXTS) {
    for (const [k, timestamps] of seenAt) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1]! >= windowMs)
        seenAt.delete(k)
    }
  }
  return true
}
