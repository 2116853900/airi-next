import type { HttpOptions } from './http'

import { fetchJson } from './http'

export const KUGOU_LYRICS_API_BASE = 'https://lyrics.kugou.com'

export interface KugouLyricsCandidate {
  id: number | string
  /** Access key required by the download endpoint, paired with `id`. */
  accesskey: string
  /** Song title of the lyrics upload. */
  song: string
  /** Artist name of the lyrics upload. */
  singer: string
  /** Track length in milliseconds. */
  duration?: number
  /** KuGou's own keyword match score; higher ranks first. */
  score?: number
}

interface KugouSearchPayload {
  status?: number
  candidates?: KugouLyricsCandidate[]
}

interface KugouDownloadPayload {
  status?: number
  /** Base64-encoded LRC document. */
  content?: string
}

/** Search query for {@link searchKugouLyrics}. */
export interface KugouLyricsSearchOptions {
  /**
   * Keyword in KuGou's `artist - title` form. A bare title returns no
   * candidates on this endpoint.
   */
  keyword: string
  /** Track duration in ms; KuGou ranks duration-matching uploads first. */
  durationMs?: number
}

/**
 * Searches KuGou's lyrics service for downloadable LRC candidates.
 *
 * @example
 * await searchKugouLyrics({ keyword: 'G.E.M.邓紫棋 - 光年之外', durationMs: 235_505 })
 * // => [{ id: 413673152, accesskey: '...', song: '光年之外', singer: 'G.E.M. 邓紫棋', duration: 235000, score: 60 }, ...]
 */
export async function searchKugouLyrics(options: KugouLyricsSearchOptions, http: HttpOptions = {}): Promise<KugouLyricsCandidate[]> {
  const params = new URLSearchParams({
    ver: '1',
    man: 'yes',
    client: 'pc',
    keyword: options.keyword,
    hash: '',
  })
  if (options.durationMs != null && options.durationMs > 0)
    params.set('duration', String(Math.round(options.durationMs)))

  const url = `${KUGOU_LYRICS_API_BASE}/search?${params.toString()}`
  const payload = await fetchJson<KugouSearchPayload>(url, http)
  return Array.isArray(payload.candidates) ? payload.candidates : []
}

// atob yields Latin-1 code units, so the base64 payload has to be decoded
// into bytes first for the UTF-8 lyrics text to survive. Buffer would only
// work in Node, and this module also runs in renderer processes.
function decodeBase64Utf8(value: string): string {
  const bytes = Uint8Array.from(atob(value.replace(/\s+/g, '')), character => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Downloads the LRC document for a KuGou search candidate.
 *
 * Returns null when the candidate has no downloadable lyrics or the request
 * fails, so resolution can move on to the next candidate.
 */
export async function downloadKugouLyrics(candidate: Pick<KugouLyricsCandidate, 'id' | 'accesskey'>, http: HttpOptions = {}): Promise<string | null> {
  const params = new URLSearchParams({
    ver: '1',
    client: 'pc',
    id: String(candidate.id),
    accesskey: candidate.accesskey,
    fmt: 'lrc',
    charset: 'utf8',
  })

  const url = `${KUGOU_LYRICS_API_BASE}/download?${params.toString()}`
  try {
    const payload = await fetchJson<KugouDownloadPayload>(url, http)
    if (!payload?.content)
      return null
    return decodeBase64Utf8(payload.content)
  }
  catch {
    return null
  }
}
