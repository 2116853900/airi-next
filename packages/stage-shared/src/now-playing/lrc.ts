import type { NowPlayingLyricsLine } from './types'

const LRC_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

function timestampToMilliseconds(minutes: number, seconds: number, fractionDigits: string | undefined) {
  // LRC uses `[mm:ss.xx]` where xx is hundredths of a second; some exports
  // (NetEase) use `[mm:ss.xxx]` with milliseconds. Padding right to three
  // digits normalizes both to milliseconds.
  const fractionMs = fractionDigits ? Number(fractionDigits.padEnd(3, '0').slice(0, 3)) : 0
  return minutes * 60_000 + seconds * 1_000 + fractionMs
}

/**
 * Parses an LRC lyrics document into timed lines.
 *
 * Metadata tags such as `[ti:]`, `[ar:]`, and `[offset:]` are skipped along
 * with any other lines that carry no timestamp. A line with multiple
 * timestamps (e.g. `[00:12.00][00:24.00]Chorus`) is expanded once per
 * timestamp. Output is sorted by start time.
 *
 * @example
 * parseLrc('[00:12.00]First line\n[00:12.5]Second\n[ar:Artist]')
 * // => [
 * //   { timeMs: 12000, text: 'First line' },
 * //   { timeMs: 12500, text: 'Second' },
 * // ]
 */
export function parseLrc(text: string): NowPlayingLyricsLine[] {
  const lines: NowPlayingLyricsLine[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line)
      continue

    LRC_TIMESTAMP_PATTERN.lastIndex = 0
    const timestamps: number[] = []
    let contentStart = 0
    let match: RegExpExecArray | null

    while ((match = LRC_TIMESTAMP_PATTERN.exec(line)) !== null) {
      timestamps.push(timestampToMilliseconds(Number(match[1]), Number(match[2]), match[3]))
      contentStart = match.index + match[0].length
    }

    if (timestamps.length === 0)
      continue

    const content = line.slice(contentStart).trim()
    for (const timeMs of timestamps)
      lines.push({ timeMs, text: content })
  }

  lines.sort((a, b) => a.timeMs - b.timeMs)
  return lines
}

/**
 * Finds the index of the active lyric line for a playback position.
 *
 * Returns the last line whose start time is not after `positionMs`; -1 when
 * the lyrics are empty or the position is before the first line.
 *
 * @example
 * const lines = parseLrc('[00:10.00]A\n[00:20.00]B')
 * findCurrentLineIndex(lines, 15_000)
 * // => 0
 */
export function findCurrentLineIndex(lines: NowPlayingLyricsLine[], positionMs: number): number {
  if (lines.length === 0)
    return -1
  if (positionMs < lines[0].timeMs)
    return -1

  let index = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].timeMs <= positionMs)
      index = i
    else
      break
  }
  return index
}
