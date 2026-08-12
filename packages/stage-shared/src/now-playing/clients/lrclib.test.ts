import type { LrclibSearchResult } from './lrclib'

import { describe, expect, it, vi } from 'vitest'

import { getLrclibBySignature, getLrclibSyncedLyrics, LRCLIB_API_BASE, pickLrclibBestMatch, searchLrclib } from './lrclib'

function createFetchMock(payload: unknown, ok = true, status?: number) {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve({
    ok,
    status: status ?? (ok ? 200 : 500),
    async json() {
      return payload
    },
  } as unknown as Response))
}

const sampleResults: LrclibSearchResult[] = [
  {
    id: 1,
    trackName: 'Lights',
    artistName: 'Ellie Goulding',
    instrumental: false,
    plainLyrics: 'plain',
    syncedLyrics: '[00:01.00]I had a way then',
  },
  {
    id: 2,
    trackName: 'Another Song',
    artistName: 'Someone',
    instrumental: true,
    plainLyrics: null,
    syncedLyrics: null,
  },
]

describe('searchLrclib', () => {
  it('builds the search URL with supported encoded params and a User-Agent header', async () => {
    const fetchMock = createFetchMock([])

    await searchLrclib({ trackName: '光年之外', artistName: 'G.E.M. 邓紫棋' }, { fetchImpl: fetchMock })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`${LRCLIB_API_BASE}/search?`)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('track_name')).toBe('光年之外')
    expect(parsed.searchParams.get('artist_name')).toBe('G.E.M. 邓紫棋')
    expect(parsed.searchParams.has('duration')).toBe(false)
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/proj-airi/)
  })

  it('builds a broad keyword query', async () => {
    const fetchMock = createFetchMock([])

    await searchLrclib({ query: 'Lights Ellie Goulding' }, { fetchImpl: fetchMock })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?]
    expect(new URL(url).searchParams.get('q')).toBe('Lights Ellie Goulding')
  })

  it('returns the mapped search results', async () => {
    const fetchMock = createFetchMock(sampleResults)

    const results = await searchLrclib({ trackName: 'Lights', artistName: 'Ellie Goulding' }, { fetchImpl: fetchMock })

    expect(results).toEqual(sampleResults)
  })

  it('throws when the response is not ok', async () => {
    const fetchMock = createFetchMock({}, false)

    await expect(searchLrclib({ trackName: 'Lights', artistName: 'x' }, { fetchImpl: fetchMock })).rejects.toThrow(/status 500/)
  })
})

describe('getLrclibSyncedLyrics', () => {
  it('fetches a track by id', async () => {
    const fetchMock = createFetchMock(sampleResults[0])

    const result = await getLrclibSyncedLyrics(1, { fetchImpl: fetchMock })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?]
    expect(url).toBe(`${LRCLIB_API_BASE}/get/1`)
    expect(result.syncedLyrics).toBe('[00:01.00]I had a way then')
  })
})

describe('getLrclibBySignature', () => {
  it('builds the /api/get URL with the track signature and rounded duration', async () => {
    const fetchMock = createFetchMock(sampleResults[0])

    await getLrclibBySignature({
      trackName: '光年之外',
      artistName: 'G.E.M. 邓紫棋',
      albumName: '新的心跳',
      durationSec: 235.505,
    }, { fetchImpl: fetchMock })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`${LRCLIB_API_BASE}/get?`)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('track_name')).toBe('光年之外')
    expect(parsed.searchParams.get('artist_name')).toBe('G.E.M. 邓紫棋')
    expect(parsed.searchParams.get('album_name')).toBe('新的心跳')
    expect(parsed.searchParams.get('duration')).toBe('236')
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/proj-airi/)
  })

  it('omits the optional album and duration params when they are missing', async () => {
    const fetchMock = createFetchMock(sampleResults[0])

    await getLrclibBySignature({ trackName: 'Lights', artistName: 'Ellie Goulding' }, { fetchImpl: fetchMock })

    const parsed = new URL((fetchMock.mock.calls[0] as [string])[0])
    expect(parsed.searchParams.has('album_name')).toBe(false)
    expect(parsed.searchParams.has('duration')).toBe(false)
  })

  it('returns null when no record matches the signature', async () => {
    const fetchMock = createFetchMock({}, false, 404)

    await expect(getLrclibBySignature({ trackName: 'x', artistName: 'y' }, { fetchImpl: fetchMock })).resolves.toBeNull()
  })

  it('throws on non-404 failures', async () => {
    const fetchMock = createFetchMock({}, false, 500)

    await expect(getLrclibBySignature({ trackName: 'x', artistName: 'y' }, { fetchImpl: fetchMock })).rejects.toThrow(/status 500/)
  })
})

describe('pickLrclibBestMatch', () => {
  const track = { title: 'Lights', artist: 'Ellie Goulding' }

  it('prefers an exact case-insensitive track + artist match', () => {
    const results = [
      { ...sampleResults[0], trackName: 'LIGHTS', artistName: 'ELLIE GOULDING' },
      sampleResults[1],
    ]

    expect(pickLrclibBestMatch(results, track)?.id).toBe(1)
  })

  it('matches artist metadata that differs only by punctuation and whitespace', () => {
    const results = [
      { ...sampleResults[0], id: 1, trackName: 'Different Song', artistName: 'Other Artist' },
      { ...sampleResults[0], id: 2, trackName: '光年之外', artistName: 'G.E.M.邓紫棋' },
    ]

    expect(pickLrclibBestMatch(results, { title: '光年之外', artist: 'G.E.M. 邓紫棋' })?.id).toBe(2)
  })

  it('prefers the duration-closest upload among same-named results', () => {
    // ROOT CAUSE:
    //
    // LRCLIB search returns several uploads sharing one title and artist with
    // durations spread over tens of seconds (live cuts, edits, truncated
    // uploads). The old picker took the first normalized title+artist match,
    // so a wrong-duration upload with partial lyrics could win over the
    // upload that matches the playing recording.
    //
    // We fixed this by ranking results with a duration-proximity score next
    // to the metadata score.
    const results = [
      { ...sampleResults[0], id: 1, duration: 217, syncedLyrics: '[00:01.00]partial upload' },
      { ...sampleResults[0], id: 2, duration: 236, syncedLyrics: '[00:01.00]full upload' },
    ]

    expect(pickLrclibBestMatch(results, { title: 'Lights', artist: 'Ellie Goulding', durationMs: 235_500 })?.id).toBe(2)
  })

  it('never picks an unrelated result just because it has synced lyrics', () => {
    // ROOT CAUSE:
    //
    // The old fallback returned the first result carrying synced lyrics, so a
    // broad keyword search could attach a completely different song's lyrics
    // to the playing track. Ranking now requires a title or artist relation
    // before any synced-lyrics bonus applies.
    const results = [
      { ...sampleResults[0], id: 1, trackName: 'Lights (Remix)', artistName: 'Other', syncedLyrics: null },
      { ...sampleResults[1], id: 2, instrumental: false, syncedLyrics: '[00:01.00]lyric' },
    ]

    expect(pickLrclibBestMatch(results, track)?.id).toBe(1)
  })

  it('returns null for an empty result list', () => {
    expect(pickLrclibBestMatch([], track)).toBeNull()
  })

  it('returns null when no result has synced lyrics', () => {
    expect(pickLrclibBestMatch([sampleResults[1]], track)).toBeNull()
  })
})
