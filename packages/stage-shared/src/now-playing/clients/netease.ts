import type { HttpOptions } from './http'

import { fetchJson } from './http'

export const NETEASE_API_BASE = 'https://music.163.com/api'

// NetEase blocks non-browser requests; mirror a desktop client-ish profile.
const NETEASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Referer': 'https://music.163.com',
  'Cookie': 'os=pc; appver=2.9.7',
}

export interface NetEaseSong {
  id: number
  name: string
  /** Artist shape returned by the current search endpoint. */
  artists?: Array<{ name: string }>
  /** Artist shape returned by newer NetEase endpoints. */
  ar?: Array<{ name: string }>
  al?: { name: string }
  /** Track length in milliseconds (legacy search endpoint). */
  duration?: number
  /** Track length in milliseconds (newer endpoints). */
  dt?: number
}

export interface NetEaseLyric {
  /** LRC synced lyrics text (may be empty when the song has none). */
  lrc: string | null
  /** Optional translation lines, kept for future bilingual mode. */
  tlyric: string | null
}

interface NetEaseSearchPayload {
  result?: {
    songs?: NetEaseSong[]
  }
}

interface NetEaseLyricPayload {
  nolyric?: boolean
  lrc?: { lyric?: string }
  tlyric?: { lyric?: string }
}

/**
 * Searches NetEase Cloud Music for a song by keyword.
 *
 * @example
 * await searchNetEaseSong('G.E.M. 光年之外')
 */
export async function searchNetEaseSong(keyword: string, http: HttpOptions = {}): Promise<NetEaseSong[]> {
  const url = `${NETEASE_API_BASE}/search/get?type=1&s=${encodeURIComponent(keyword)}`
  const payload = await fetchJson<NetEaseSearchPayload>(url, { ...http, headers: NETEASE_HEADERS })
  const songs = payload.result?.songs
  return Array.isArray(songs) ? songs : []
}

/**
 * Fetches the LRC lyrics for a NetEase song id.
 *
 * Returns null when the song has no lyrics (`nolyric`) or the request fails.
 */
export async function getNetEaseLyric(songId: number, http: HttpOptions = {}): Promise<NetEaseLyric | null> {
  const url = `${NETEASE_API_BASE}/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`
  try {
    const payload = await fetchJson<NetEaseLyricPayload>(url, { ...http, headers: NETEASE_HEADERS })
    if (!payload || payload.nolyric)
      return null

    return {
      lrc: payload.lrc?.lyric || null,
      tlyric: payload.tlyric?.lyric || null,
    }
  }
  catch {
    return null
  }
}
