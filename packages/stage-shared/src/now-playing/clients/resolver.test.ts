import type { FetchLike } from './http'

import { describe, expect, it, vi } from 'vitest'

import { resolveLyricsForTrack } from './resolver'

const TRACK = { title: '光年之外', artist: 'G.E.M. 邓紫棋', durationMs: 235_000 }

/** Builds an LRC document whose lines span the duration up to `endRatio`. */
function lrcCovering(durationMs: number, lineCount: number, endRatio = 0.9, prefix = 'line'): string {
  const endMs = Math.floor(durationMs * endRatio)
  const stepMs = Math.floor(endMs / lineCount)
  return Array.from({ length: lineCount }, (_, index) => {
    const timeMs = stepMs * (index + 1)
    const minutes = Math.floor(timeMs / 60_000)
    const seconds = ((timeMs % 60_000) / 1000).toFixed(2).padStart(5, '0')
    return `[${String(minutes).padStart(2, '0')}:${seconds}]${prefix} ${index + 1}`
  }).join('\n')
}

const LRCLIB_FULL_LRC = lrcCovering(TRACK.durationMs, 30, 0.9, 'lrclib')
const LRCLIB_TRUNCATED_LRC = lrcCovering(TRACK.durationMs, 12, 0.35, 'lrclib-cut')
const NETEASE_FULL_LRC = lrcCovering(TRACK.durationMs, 28, 0.88, 'netease')
const KUGOU_FULL_LRC = lrcCovering(TRACK.durationMs, 26, 0.9, 'kugou')

/** Encodes UTF-8 text the way KuGou's download endpoint does (base64 over UTF-8 bytes). */
function base64FromUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

function jsonResponse(payload: unknown, ok = true, status?: number) {
  return {
    ok,
    status: status ?? (ok ? 200 : 500),
    async json() {
      return payload
    },
  } as Response
}

/** Routes requests by URL host/path to canned NetEase or LRCLIB responses. */
function createRoutingFetch(options: {
  /** Record served by the LRCLIB signature endpoint; defaults to a 404 miss. */
  lrclibSignature?: unknown
  lrclib?: { results: unknown[], ok?: boolean }
  /** Overrides the results for the broad `q` search when provided. */
  lrclibBroad?: { results: unknown[] }
  neteaseSearch?: { songs: unknown[], ok?: boolean }
  neteaseLyric?: unknown
  neteaseLyrics?: Record<number, unknown>
  kugouSearch?: { candidates: unknown[] }
  /** Raw LRC text per candidate id; served base64-encoded like the real endpoint. */
  kugouLyrics?: Record<string, string>
}): { fetchImpl: FetchLike, calls: string[] } {
  const calls: string[] = []
  const fetchImpl: FetchLike = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('lrclib.net/api/get?')) {
      if (options.lrclibSignature === undefined)
        return jsonResponse({}, false, 404)
      return jsonResponse(options.lrclibSignature)
    }
    if (url.includes('lrclib.net')) {
      if (options.lrclibBroad && new URL(url).searchParams.has('q'))
        return jsonResponse(options.lrclibBroad.results)
      return jsonResponse(options.lrclib?.results ?? [], options.lrclib?.ok ?? true)
    }
    if (url.includes('/api/search/get')) {
      const songs = options.neteaseSearch?.songs ?? []
      return jsonResponse({ result: { songs } }, options.neteaseSearch?.ok ?? true)
    }
    if (url.includes('/api/song/lyric')) {
      const songId = Number(new URL(url).searchParams.get('id'))
      return jsonResponse(options.neteaseLyrics?.[songId] ?? options.neteaseLyric ?? { lrc: { lyric: NETEASE_FULL_LRC } })
    }
    if (url.includes('lyrics.kugou.com/search')) {
      return jsonResponse({ status: 200, candidates: options.kugouSearch?.candidates ?? [] })
    }
    if (url.includes('lyrics.kugou.com/download')) {
      const candidateId = new URL(url).searchParams.get('id') ?? ''
      const lrc = options.kugouLyrics?.[candidateId]
      return jsonResponse(lrc ? { status: 200, content: base64FromUtf8(lrc) } : { status: 200 })
    }
    return jsonResponse({}, false)
  })
  return { fetchImpl, calls }
}

describe('resolveLyricsForTrack', () => {
  it('returns lyrics from the LRCLIB signature lookup without further requests', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclibSignature: { id: 9, trackName: TRACK.title, artistName: TRACK.artist, duration: 235, instrumental: false, plainLyrics: null, syncedLyrics: LRCLIB_FULL_LRC },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('lrclib')
    expect(result.lines).toHaveLength(30)
    expect(calls).toHaveLength(1)
    const parsed = new URL(calls[0])
    expect(parsed.pathname).toBe('/api/get')
    expect(parsed.searchParams.get('duration')).toBe('235')
  })

  it('falls back to LRCLIB search when the signature lookup misses', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, duration: 235, instrumental: false, plainLyrics: null, syncedLyrics: LRCLIB_FULL_LRC }] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('lrclib')
    expect(result.lines).toHaveLength(30)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('/api/search')
    expect(calls.every(url => url.includes('lrclib.net'))).toBe(true)
  })

  it('retries LRCLIB with a broad query when the metadata search misses', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [] },
      lrclibBroad: { results: [{ id: 1, trackName: TRACK.title, artistName: 'G.E.M.邓紫棋', duration: 235, instrumental: false, plainLyrics: null, syncedLyrics: LRCLIB_FULL_LRC }] },
    })

    // ROOT CAUSE:
    //
    // LRCLIB metadata search can miss a record when player metadata differs
    // from the database. The resolver did not use LRCLIB's broad `q` search.
    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('lrclib')
    expect(result.lines).toHaveLength(30)
    expect(calls).toHaveLength(3)
    expect(new URL(calls[2]).searchParams.get('q')).toBe(`${TRACK.title} ${TRACK.artist}`)
  })

  it('prefers complete NetEase lyrics over a truncated LRCLIB transcript', async () => {
    const { fetchImpl } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, duration: 235, instrumental: false, plainLyrics: null, syncedLyrics: LRCLIB_TRUNCATED_LRC }] },
      neteaseSearch: { songs: [{ id: 42, name: TRACK.title, artists: [{ name: TRACK.artist }], duration: 235_505 }] },
      neteaseLyric: { lrc: { lyric: NETEASE_FULL_LRC } },
    })

    // ROOT CAUSE:
    //
    // The resolver accepted the first LRCLIB result carrying any synced
    // lyrics. Community uploads are sometimes truncated mid-song, so the
    // panel stopped rendering lyrics halfway through playback even though a
    // complete transcript existed on the fallback source.
    //
    // We fixed this with a completeness gate (line count plus coverage of the
    // track duration): an incomplete candidate no longer stops the search,
    // and the fallback source can supply the full transcript.
    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('netease')
    expect(result.lines).toHaveLength(28)
  })

  it('keeps the best partial lyrics when every source is incomplete', async () => {
    const { fetchImpl } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, duration: 235, instrumental: false, plainLyrics: null, syncedLyrics: LRCLIB_TRUNCATED_LRC }] },
      neteaseSearch: { songs: [] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('lrclib')
    expect(result.lines).toHaveLength(12)
  })

  it('falls back to NetEase when the LRCLIB request fails', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [], ok: false },
      neteaseSearch: { songs: [{ id: 42, name: TRACK.title, artists: [{ name: TRACK.artist }], duration: 235_505 }] },
    })

    // ROOT CAUSE:
    //
    // One LRCLIB network error ended the complete lookup. The configured
    // NetEase source did not receive a request.
    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('netease')
    expect(result.lines).toHaveLength(28)
    expect(calls.some(url => url.includes('/api/search/get'))).toBe(true)
  })

  it('prefers the NetEase candidate whose duration matches the track', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [] },
      neteaseSearch: {
        songs: [
          { id: 10, name: TRACK.title, artists: [{ name: TRACK.artist }], duration: 277_098 },
          { id: 20, name: TRACK.title, artists: [{ name: TRACK.artist }], duration: 235_505 },
        ],
      },
      neteaseLyrics: {
        10: { lrc: { lyric: lrcCovering(277_098, 30, 0.9) } },
        20: { lrc: { lyric: NETEASE_FULL_LRC } },
      },
    })

    // ROOT CAUSE:
    //
    // NetEase search often ranks a live recording above the studio recording
    // while both carry the same name and artist. Candidate ranking ignored
    // the track duration, so the resolver fetched lyrics for the wrong
    // recording and the lines drifted away from playback.
    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('netease')
    expect(calls.filter(url => url.includes('/api/song/lyric'))).toEqual([
      expect.stringContaining('id=20'),
    ])
  })

  it('tries the matching NetEase candidates until one has lyrics', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [] },
      neteaseSearch: {
        songs: [
          { id: 10, name: `${TRACK.title} (Live)`, artists: [{ name: 'Other Artist' }] },
          { id: 20, name: TRACK.title, artists: [{ name: TRACK.artist }] },
        ],
      },
      neteaseLyrics: {
        10: { nolyric: true },
        20: { lrc: { lyric: NETEASE_FULL_LRC } },
      },
    })

    // ROOT CAUSE:
    //
    // The resolver used only the first NetEase result. Search ranking can put
    // a live version or a result without lyrics before the requested track.
    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('netease')
    expect(result.lines).toHaveLength(28)
    expect(calls.filter(url => url.includes('/api/song/lyric'))).toEqual([
      expect.stringContaining('id=20'),
    ])
  })

  it('falls back to KuGou when LRCLIB and NetEase have no usable lyrics', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [] },
      neteaseSearch: { songs: [] },
      kugouSearch: {
        candidates: [
          { id: 91, accesskey: 'KEY-91', song: TRACK.title, singer: TRACK.artist, duration: 277_098 },
          { id: 92, accesskey: 'KEY-92', song: TRACK.title, singer: TRACK.artist, duration: 235_000 },
        ],
      },
      kugouLyrics: { 92: KUGOU_FULL_LRC },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('kugou')
    expect(result.lines).toHaveLength(26)
    // Duration-aware ranking downloads the matching upload, not the live cut.
    expect(calls.filter(url => url.includes('lyrics.kugou.com/download'))).toEqual([
      expect.stringContaining('id=92'),
    ])
    const searchUrl = calls.find(url => url.includes('lyrics.kugou.com/search'))
    expect(searchUrl).toBeTruthy()
    // KuGou needs the `artist - title` keyword form and the duration hint.
    expect(new URL(searchUrl!).searchParams.get('keyword')).toBe(`${TRACK.artist} - ${TRACK.title}`)
    expect(new URL(searchUrl!).searchParams.get('duration')).toBe('235000')
  })

  it('prefers complete KuGou lyrics when LRCLIB and NetEase are truncated', async () => {
    const { fetchImpl } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, duration: 235, instrumental: false, plainLyrics: null, syncedLyrics: LRCLIB_TRUNCATED_LRC }] },
      neteaseSearch: { songs: [{ id: 42, name: TRACK.title, artists: [{ name: TRACK.artist }], duration: 235_505 }] },
      neteaseLyrics: { 42: { lrc: { lyric: lrcCovering(TRACK.durationMs, 10, 0.3, 'netease-cut') } } },
      kugouSearch: {
        candidates: [{ id: 93, accesskey: 'KEY-93', song: TRACK.title, singer: TRACK.artist, duration: 235_000 }],
      },
      kugouLyrics: { 93: KUGOU_FULL_LRC },
    })

    // The completeness gate spans all three sources: truncated transcripts on
    // LRCLIB and NetEase must not stop the search when KuGou still has a
    // complete one.
    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('kugou')
    expect(result.lines).toHaveLength(26)
  })

  it('returns none when every source misses', async () => {
    const { fetchImpl } = createRoutingFetch({
      lrclib: { results: [] },
      neteaseSearch: { songs: [] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result).toEqual({ source: 'none', lines: null })
  })

  it('does not fall back when the configured source is lrclib only', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, duration: 235, instrumental: false, plainLyrics: 'plain', syncedLyrics: null }] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib', fetchImpl })

    expect(result).toEqual({ source: 'none', lines: null })
    expect(calls.every(url => url.includes('lrclib.net'))).toBe(true)
  })

  it('treats an instrumental LRCLIB signature match as no lyrics', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclibSignature: { id: 2, trackName: TRACK.title, artistName: TRACK.artist, duration: 235, instrumental: true, plainLyrics: null, syncedLyrics: null },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result).toEqual({ source: 'none', lines: null })
    expect(calls).toHaveLength(1)
  })

  it('treats an instrumental LRCLIB search match as no lyrics', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, instrumental: true, plainLyrics: null, syncedLyrics: null }] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result).toEqual({ source: 'none', lines: null })
    expect(calls).toHaveLength(2)
  })

  it('captures network failures as lyricsError instead of throwing', async () => {
    const { fetchImpl } = createRoutingFetch({ lrclib: { results: [], ok: false } })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('none')
    expect(result.lines).toBeNull()
    expect(result.error).toBeTruthy()
  })
})
