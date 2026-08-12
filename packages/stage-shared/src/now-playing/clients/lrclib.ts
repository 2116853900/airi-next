import type { NowPlayingTrack } from '../types'
import type { HttpOptions } from './http'

import { fetchJson, fetchJsonOrNull } from './http'
import { scoreDurationMatch, scoreLyricsMetadata } from './metadata-matching'

export const LRCLIB_API_BASE = 'https://lrclib.net/api'

// LRCLIB rejects requests without a descriptive User-Agent.
const LRCLIB_USER_AGENT = 'proj-airi/stage-tamagotchi (https://github.com/moeru-ai/airi)'

export interface LrclibSearchResult {
  id: number
  trackName: string
  artistName: string
  albumName?: string
  /** Track duration in seconds. */
  duration?: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

/** Parameters for an LRCLIB metadata search or broad keyword search. */
export type LrclibSearchOptions
  = | {
    /** Keyword that LRCLIB matches against all metadata fields. */
    query: string
  }
  | {
    /** Track title from the playback provider. */
    trackName: string
    /** Artist name from the playback provider. */
    artistName: string
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
  if ('query' in options) {
    query.set('q', options.query)
  }
  else {
    query.set('track_name', options.trackName)
    if (options.artistName)
      query.set('artist_name', options.artistName)
  }

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

/** Exact-signature lookup query for {@link getLrclibBySignature}. */
export interface LrclibSignatureQuery {
  trackName: string
  artistName: string
  /** Album name; improves precision when it matches LRCLIB's record. */
  albumName?: string
  /** Track duration in seconds; LRCLIB matches records within ±2 seconds. */
  durationSec?: number
}

/**
 * Fetches lyrics through LRCLIB's exact signature endpoint (`/api/get`).
 *
 * LRCLIB enforces the ±2s duration tolerance server-side, so a hit identifies
 * the exact recording that is playing and its transcript aligns with
 * playback. Returns null when no record matches the signature; callers fall
 * back to the `/api/search` endpoint.
 */
export async function getLrclibBySignature(query: LrclibSignatureQuery, http: HttpOptions = {}): Promise<LrclibSearchResult | null> {
  const params = new URLSearchParams()
  params.set('track_name', query.trackName)
  params.set('artist_name', query.artistName)
  if (query.albumName)
    params.set('album_name', query.albumName)
  if (query.durationSec != null)
    params.set('duration', String(Math.round(query.durationSec)))

  const url = `${LRCLIB_API_BASE}/get?${params.toString()}`
  return await fetchJsonOrNull<LrclibSearchResult>(url, { ...http, headers: lrclibHeaders() })
}

// A candidate needs at least a partial title or an exact artist relation
// (see scoreLyricsMetadata) before other bonuses can rank it. This stops a
// broad keyword search from attaching a completely unrelated song's lyrics
// just because that result happens to carry synced lyrics.
const MIN_RELEVANCE_SCORE = 4

/**
 * Picks the best LRCLIB search match for a track.
 *
 * Ranks results by metadata similarity, duration proximity, and whether they
 * carry synced lyrics. LRCLIB search often returns several uploads of the
 * same title with different durations (live cuts, edits, truncated uploads);
 * duration proximity keeps the recording that is actually playing on top.
 *
 * @example
 * pickLrclibBestMatch([{ trackName: 'Lights', artistName: 'Ellie Goulding', duration: 235, syncedLyrics: '...' }], { title: 'Lights', artist: 'Ellie Goulding', durationMs: 235_500 })
 * // => the match
 */
export function pickLrclibBestMatch(results: LrclibSearchResult[], track: Pick<NowPlayingTrack, 'title' | 'artist' | 'durationMs'>): LrclibSearchResult | null {
  let best: LrclibSearchResult | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const result of results) {
    const relevance = scoreLyricsMetadata(
      { title: result.trackName ?? '', artist: result.artistName ?? '' },
      track,
    )
    if (relevance < MIN_RELEVANCE_SCORE)
      continue

    let score = relevance + scoreDurationMatch(
      result.duration != null ? result.duration * 1000 : undefined,
      track.durationMs,
    )
    // Synced lyrics are the goal; a confirmed instrumental is still a usable
    // answer (the resolver reports "no lyrics" instead of searching on).
    if (result.syncedLyrics)
      score += 3
    else if (result.instrumental)
      score += 1

    if (score > bestScore) {
      best = result
      bestScore = score
    }
  }

  return best
}
