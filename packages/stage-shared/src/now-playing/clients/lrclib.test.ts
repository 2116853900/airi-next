import type { LrclibSearchResult } from './lrclib'

import { describe, expect, it, vi } from 'vitest'

import { getLrclibSyncedLyrics, LRCLIB_API_BASE, pickLrclibBestMatch, searchLrclib } from './lrclib'

function createFetchMock(payload: unknown, ok = true) {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve({
    ok,
    status: ok ? 200 : 500,
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
  it('builds the search URL with encoded params and a User-Agent header', async () => {
    const fetchMock = createFetchMock([])

    await searchLrclib({ trackName: '光年之外', artistName: 'G.E.M. 邓紫棋', durationMs: 235_000 }, { fetchImpl: fetchMock })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`${LRCLIB_API_BASE}/search?`)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('track_name')).toBe('光年之外')
    expect(parsed.searchParams.get('artist_name')).toBe('G.E.M. 邓紫棋')
    expect(parsed.searchParams.get('duration')).toBe('235')
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/proj-airi/)
  })

  it('omits the duration param when unknown', async () => {
    const fetchMock = createFetchMock([])

    await searchLrclib({ trackName: 'Lights', artistName: 'Ellie Goulding' }, { fetchImpl: fetchMock })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?]
    expect(new URL(url).searchParams.has('duration')).toBe(false)
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

describe('pickLrclibBestMatch', () => {
  const track = { title: 'Lights', artist: 'Ellie Goulding' }

  it('prefers an exact case-insensitive track + artist match', () => {
    const results = [
      { ...sampleResults[0], trackName: 'LIGHTS', artistName: 'ELLIE GOULDING' },
      sampleResults[1],
    ]

    expect(pickLrclibBestMatch(results, track)?.id).toBe(1)
  })

  it('falls back to the first result with synced lyrics', () => {
    const results = [
      { ...sampleResults[0], trackName: 'Lights (Remix)', artistName: 'Other', syncedLyrics: null },
      { ...sampleResults[1], instrumental: false, syncedLyrics: '[00:01.00]lyric' },
    ]

    expect(pickLrclibBestMatch(results, track)?.id).toBe(2)
  })

  it('returns null for an empty result list', () => {
    expect(pickLrclibBestMatch([], track)).toBeNull()
  })

  it('returns null when no result has synced lyrics', () => {
    expect(pickLrclibBestMatch([sampleResults[1]], track)).toBeNull()
  })
})
