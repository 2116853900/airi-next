import type { NowPlayingTrack } from '../types'
import type { HttpOptions } from './http'

import { fetchJson } from './http'

export const LRCLIB_API_BASE = 'https://lrclib.net/api'

// LRCLIB rejects requests without a descriptive User-Agent.
const LRCLIB_USER_AGENT = 'proj-airi/stage-tamagotchi (https://github.com/moeru-ai/airi)'

export interface LrclibSearchResult {
  id: number
  trackName: string
  artistName: string
  albumName?: string
  duration?: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

export interface LrclibSearchOptions {
  trackName: string
  artistName: string
  durationMs?: number
}

function lrclibHeaders() {
  return { 'User-Agent': LRCLIB_USER_AGENT }
}

/**
 * Searches LRCLIB for a track.
 *
 * @example
 * await searchLrclib({ trackName: 'Lights', artistName: 'Ellie Goulding' })
 */
export async function searchLrclib(options: LrclibSearchOptions, http: HttpOptions = {}): Promise<LrclibSearchResult[]> {
  const query = new URLSearchParams()
  query.set('track_name', options.trackName)
  if (options.artistName)
    query.set('artist_name', options.artistName)
  if (options.durationMs != null)
    query.set('duration', String(Math.round(options.durationMs / 1000)))

  const url = `${LRCLIB_API_BASE}/search?${query.toString()}`
  return await fetchJson<LrclibSearchResult[]>(url, { ...http, headers: lrclibHeaders() })
}

/**
 * Fetches a single LRCLIB track record by id, including synced lyrics.
 */
export async function getLrclibSyncedLyrics(id: number, http: HttpOptions = {}): Promise<LrclibSearchResult> {
  const url = `${LRCLIB_API_BASE}/get/${id}`
  return await fetchJson<LrclibSearchResult>(url, { ...http, headers: lrclibHeaders() })
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

/**
 * Picks the best LRCLIB search match for a track.
 *
 * Prefers an exact (case-insensitive) track + artist match, then falls back to
 * the first result that carries synced lyrics, then null.
 *
 * @example
 * pickLrclibBestMatch([{ trackName: 'Lights', artistName: 'Ellie Goulding', syncedLyrics: '...' }], { title: 'Lights', artist: 'Ellie Goulding' })
 * // => the match
 */
export function pickLrclibBestMatch(results: LrclibSearchResult[], track: Pick<NowPlayingTrack, 'title' | 'artist'>): LrclibSearchResult | null {
  if (results.length === 0)
    return null

  const exact = results.find(result =>
    result.trackName
    && result.artistName
    && normalize(result.trackName) === normalize(track.title)
    && normalize(result.artistName) === normalize(track.artist),
  )
  if (exact)
    return exact

  return results.find(result => Boolean(result.syncedLyrics)) ?? null
}
