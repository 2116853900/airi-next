import { describe, expect, it, vi } from 'vitest'

import { downloadKugouLyrics, KUGOU_LYRICS_API_BASE, searchKugouLyrics } from './kugou'

function createFetchMock(payload: unknown, ok = true) {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    async json() {
      return payload
    },
  } as unknown as Response))
}

/** Encodes UTF-8 text the way KuGou's download endpoint does (base64 over UTF-8 bytes). */
function base64FromUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

const LRC_TEXT = '[00:12.93]感受停在我发端的指尖\n[00:19.44]如何瞬间冻结时间'

describe('searchKugouLyrics', () => {
  it('builds the search URL with the keyword and duration in milliseconds', async () => {
    const fetchMock = createFetchMock({ status: 200, candidates: [] })

    await searchKugouLyrics({ keyword: 'G.E.M.邓紫棋 - 光年之外', durationMs: 235_505 }, { fetchImpl: fetchMock })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?]
    expect(url).toContain(`${KUGOU_LYRICS_API_BASE}/search?`)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('keyword')).toBe('G.E.M.邓紫棋 - 光年之外')
    expect(parsed.searchParams.get('duration')).toBe('235505')
    expect(parsed.searchParams.get('client')).toBe('pc')
  })

  it('omits the duration param when it is unknown', async () => {
    const fetchMock = createFetchMock({ status: 200, candidates: [] })

    await searchKugouLyrics({ keyword: 'x - y' }, { fetchImpl: fetchMock })

    const parsed = new URL((fetchMock.mock.calls[0] as [string])[0])
    expect(parsed.searchParams.has('duration')).toBe(false)
  })

  it('returns the candidates array', async () => {
    const candidates = [{ id: 413673152, accesskey: 'KEY', song: '光年之外', singer: 'G.E.M. 邓紫棋', duration: 235_000, score: 60 }]
    const fetchMock = createFetchMock({ status: 200, candidates })

    await expect(searchKugouLyrics({ keyword: 'k' }, { fetchImpl: fetchMock })).resolves.toEqual(candidates)
  })

  it('returns an empty array when the payload is malformed', async () => {
    const fetchMock = createFetchMock({})

    await expect(searchKugouLyrics({ keyword: 'k' }, { fetchImpl: fetchMock })).resolves.toEqual([])
  })

  it('throws when the response is not ok', async () => {
    const fetchMock = createFetchMock({}, false)

    await expect(searchKugouLyrics({ keyword: 'k' }, { fetchImpl: fetchMock })).rejects.toThrow(/status 500/)
  })
})

describe('downloadKugouLyrics', () => {
  it('decodes the base64 content into UTF-8 LRC text', async () => {
    const fetchMock = createFetchMock({ status: 200, fmt: 'lrc', content: base64FromUtf8(LRC_TEXT) })

    const lrc = await downloadKugouLyrics({ id: 413673152, accesskey: 'KEY' }, { fetchImpl: fetchMock })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?]
    expect(url).toContain(`${KUGOU_LYRICS_API_BASE}/download?`)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('id')).toBe('413673152')
    expect(parsed.searchParams.get('accesskey')).toBe('KEY')
    expect(parsed.searchParams.get('fmt')).toBe('lrc')
    expect(parsed.searchParams.get('charset')).toBe('utf8')
    expect(lrc).toBe(LRC_TEXT)
  })

  it('returns null when the payload has no content', async () => {
    const fetchMock = createFetchMock({ status: 200 })

    await expect(downloadKugouLyrics({ id: 1, accesskey: 'KEY' }, { fetchImpl: fetchMock })).resolves.toBeNull()
  })

  it('returns null on network failure', async () => {
    const fetchMock = createFetchMock({}, false)

    await expect(downloadKugouLyrics({ id: 1, accesskey: 'KEY' }, { fetchImpl: fetchMock })).resolves.toBeNull()
  })
})
