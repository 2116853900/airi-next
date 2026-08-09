import type { NowPlayingLyricsLine, NowPlayingLyricsSource, NowPlayingLyricsSourceSetting, NowPlayingTrack } from '../types'
import type { HttpOptions } from './http'

import { errorMessageFrom } from '@moeru/std'

import { parseLrc } from '../lrc'
import { pickLrclibBestMatch, searchLrclib } from './lrclib'
import { getNetEaseLyric, searchNetEaseSong } from './netease'

export interface ResolveLyricsOptions extends HttpOptions {
  source: NowPlayingLyricsSourceSetting
  /** Per-request timeout; defaults to 8s. */
  timeoutMs?: number
}

export interface ResolveLyricsResult {
  source: NowPlayingLyricsSource
  /** Parsed synced lines; null when no lyrics could be resolved. */
  lines: NowPlayingLyricsLine[] | null
  /** Human-readable failure reason for the last lookup attempt. */
  error?: string
}

const DEFAULT_TIMEOUT_MS = 8_000

/**
 * Resolves synced lyrics for a track.
 *
 * Tries LRCLIB first; when the configured source allows it and LRCLIB has no
 * synced lyrics, falls back to NetEase Cloud Music. Returns a discriminated
 * result so callers never receive a thrown network error over IPC.
 *
 * @example
 * await resolveLyricsForTrack({ title: '光年之外', artist: 'G.E.M. 邓紫棋' }, { source: 'lrclib-netease' })
 * // => { source: 'netease', lines: [{ timeMs: 0, text: '感受停在我发端的指尖' }, ...] }
 */
export async function resolveLyricsForTrack(track: NowPlayingTrack, options: ResolveLyricsOptions): Promise<ResolveLyricsResult> {
  const { source, fetchImpl, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

  try {
    const lrclibResults = await searchLrclib(
      { trackName: track.title, artistName: track.artist, durationMs: track.durationMs },
      { fetchImpl, signal: combinedSignal },
    )
    const bestMatch = pickLrclibBestMatch(lrclibResults, track)
    if (bestMatch) {
      if (bestMatch.instrumental)
        return { source: 'none', lines: null }
      if (bestMatch.syncedLyrics)
        return { source: 'lrclib', lines: parseLrc(bestMatch.syncedLyrics) }
    }

    if (source === 'lrclib')
      return { source: 'none', lines: null }

    const songs = await searchNetEaseSong(`${track.artist} ${track.title}`, { fetchImpl, signal: combinedSignal })
    if (songs.length === 0)
      return { source: 'none', lines: null }

    const lyric = await getNetEaseLyric(songs[0].id, { fetchImpl, signal: combinedSignal })
    if (!lyric?.lrc)
      return { source: 'none', lines: null }

    return { source: 'netease', lines: parseLrc(lyric.lrc) }
  }
  catch (error) {
    return {
      source: 'none',
      lines: null,
      error: errorMessageFrom(error) ?? 'Failed to resolve lyrics.',
    }
  }
  finally {
    clearTimeout(timeoutId)
  }
}
