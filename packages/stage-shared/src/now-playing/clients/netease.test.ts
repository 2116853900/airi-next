import { describe, expect, it, vi } from 'vitest'

import { getNetEaseLyric, NETEASE_API_BASE, searchNetEaseSong } from './netease'

function createFetchMock(payload: unknown, ok = true) {
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    async json() {
      return payload
    },
  } as unknown as Response))
}

describe('searchNetEaseSong', () => {
  it('uRL-encodes the keyword and maps the first song', async () => {
    const fetchMock = createFetchMock({
      result: {
        songs: [
          { id: 123, name: '光年之外', ar: [{ name: 'G.E.M. 邓紫棋' }], al: { name: '新的心跳' } },
        ],
      },
    })

    const songs = await searchNetEaseSong('G.E.M. 邓紫棋 光年之外', { fetchImpl: fetchMock })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`${NETEASE_API_BASE}/search/get?type=1&s=`)
    expect(new URL(url).searchParams.get('s')).toBe('G.E.M. 邓紫棋 光年之外')
    expect((init.headers as Record<string, string>).Referer).toBe('https://music.163.com')
    expect(songs).toEqual([{ id: 123, name: '光年之外', ar: [{ name: 'G.E.M. 邓紫棋' }], al: { name: '新的心跳' } }])
  })

  it('returns an empty array when the result has no songs', async () => {
    const fetchMock = createFetchMock({ result: {} })

    await expect(searchNetEaseSong('nothing', { fetchImpl: fetchMock })).resolves.toEqual([])
  })

  it('returns an empty array when the payload is malformed', async () => {
    const fetchMock = createFetchMock({})

    await expect(searchNetEaseSong('nothing', { fetchImpl: fetchMock })).resolves.toEqual([])
  })
})

describe('getNetEaseLyric', () => {
  it('maps the LRC lyric text', async () => {
    const fetchMock = createFetchMock({
      lrc: { lyric: '[00:01.00]感受停在我发端的指尖' },
      tlyric: { lyric: '[00:01.00]Feel the fingertip resting on my hair' },
    })

    const lyric = await getNetEaseLyric(123, { fetchImpl: fetchMock })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit?]
    expect(url).toContain(`${NETEASE_API_BASE}/song/lyric?id=123`)
    expect(lyric).toEqual({
      lrc: '[00:01.00]感受停在我发端的指尖',
      tlyric: '[00:01.00]Feel the fingertip resting on my hair',
    })
  })

  it('returns null for nolyric songs', async () => {
    const fetchMock = createFetchMock({ nolyric: true })

    await expect(getNetEaseLyric(123, { fetchImpl: fetchMock })).resolves.toBeNull()
  })

  it('returns null on network failure', async () => {
    const fetchMock = createFetchMock({}, false)

    await expect(getNetEaseLyric(123, { fetchImpl: fetchMock })).resolves.toBeNull()
  })
})
