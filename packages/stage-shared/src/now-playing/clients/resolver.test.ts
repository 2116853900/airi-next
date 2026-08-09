import type { FetchLike } from './http'

import { describe, expect, it, vi } from 'vitest'

import { resolveLyricsForTrack } from './resolver'

const TRACK = { title: '光年之外', artist: 'G.E.M. 邓紫棋', durationMs: 235_000 }

const LRCLIB_SYNCED = '[00:01.00]感受停在我发端的指尖\n[00:05.00]如何瞬间冻结时间'
const NETEASE_LRC = '[00:02.00]记住望着我坚定的双眼\n[00:06.00]也许已经没有明天'

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    async json() {
      return payload
    },
  } as Response
}

/** Routes requests by URL host/path to canned NetEase or LRCLIB responses. */
function createRoutingFetch(options: {
  lrclib?: { results: unknown[], ok?: boolean }
  neteaseSearch?: { songs: unknown[], ok?: boolean }
  neteaseLyric?: unknown
}): { fetchImpl: FetchLike, calls: string[] } {
  const calls: string[] = []
  const fetchImpl: FetchLike = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('lrclib.net')) {
      return jsonResponse(options.lrclib?.results ?? [], options.lrclib?.ok ?? true)
    }
    if (url.includes('/api/search/get')) {
      const songs = options.neteaseSearch?.songs ?? []
      return jsonResponse({ result: { songs } }, options.neteaseSearch?.ok ?? true)
    }
    if (url.includes('/api/song/lyric')) {
      return jsonResponse(options.neteaseLyric ?? { lrc: { lyric: NETEASE_LRC } })
    }
    return jsonResponse({}, false)
  })
  return { fetchImpl, calls }
}

describe('resolveLyricsForTrack', () => {
  it('returns parsed LRCLIB lyrics with source lrclib on a synced hit', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, instrumental: false, plainLyrics: null, syncedLyrics: LRCLIB_SYNCED }] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('lrclib')
    expect(result.lines).toHaveLength(2)
    expect(result.lines?.[0]).toEqual({ timeMs: 1_000, text: '感受停在我发端的指尖' })
    expect(calls.every(url => url.includes('lrclib.net'))).toBe(true)
  })

  it('falls back to NetEase when LRCLIB has no synced lyrics', async () => {
    const { fetchImpl } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, instrumental: false, plainLyrics: 'plain only', syncedLyrics: null }] },
      neteaseSearch: { songs: [{ id: 42, name: TRACK.title, ar: [{ name: TRACK.artist }] }] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('netease')
    expect(result.lines?.[0]).toEqual({ timeMs: 2_000, text: '记住望着我坚定的双眼' })
  })

  it('returns none when both sources miss', async () => {
    const { fetchImpl } = createRoutingFetch({
      lrclib: { results: [] },
      neteaseSearch: { songs: [] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result).toEqual({ source: 'none', lines: null })
  })

  it('does not fall back when the configured source is lrclib only', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, instrumental: false, plainLyrics: 'plain', syncedLyrics: null }] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib', fetchImpl })

    expect(result).toEqual({ source: 'none', lines: null })
    expect(calls.every(url => url.includes('lrclib.net'))).toBe(true)
  })

  it('treats an instrumental LRCLIB match as no lyrics', async () => {
    const { fetchImpl, calls } = createRoutingFetch({
      lrclib: { results: [{ id: 1, trackName: TRACK.title, artistName: TRACK.artist, instrumental: true, plainLyrics: null, syncedLyrics: null }] },
    })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result).toEqual({ source: 'none', lines: null })
    expect(calls).toHaveLength(1)
  })

  it('captures network failures as lyricsError instead of throwing', async () => {
    const { fetchImpl } = createRoutingFetch({ lrclib: { results: [], ok: false } })

    const result = await resolveLyricsForTrack(TRACK, { source: 'lrclib-netease', fetchImpl })

    expect(result.source).toBe('none')
    expect(result.lines).toBeNull()
    expect(result.error).toBeTruthy()
  })
})
