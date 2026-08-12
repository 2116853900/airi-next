import type { FetchLike, NowPlayingTrack } from '@proj-airi/stage-shared/now-playing'

import type { MprisPlayer, MprisProvider } from './mpris'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { setupNowPlayingEngine } from './engine'

const track: NowPlayingTrack = {
  title: 'Test Song',
  artist: 'Test Artist',
  durationMs: 180_000,
}

function lyricsFetch(): FetchLike {
  return vi.fn(async () => new Response(JSON.stringify([{
    id: 1,
    trackName: track.title,
    artistName: track.artist,
    instrumental: false,
    plainLyrics: 'First line',
    syncedLyrics: '[00:00.00]First line\n[00:02.00]Second line',
  }]), {
    headers: { 'Content-Type': 'application/json' },
  }))
}

const engines: Array<ReturnType<typeof setupNowPlayingEngine>> = []

afterEach(() => {
  for (const engine of engines)
    engine.stop()
  engines.length = 0
})

describe('now-playing owned playback', () => {
  it('resolves lyrics and ignores a stale stop from another playback session', async () => {
    const engine = setupNowPlayingEngine({
      fetchImpl: lyricsFetch(),
      lyricsSource: 'lrclib',
      pollIntervalMs: 10,
    })
    engines.push(engine)
    engine.start()

    engine.updatePlayback({
      owner: 'song-request',
      trackId: 'session-1',
      status: 'playing',
      positionMs: 0,
      track,
    })

    await vi.waitFor(() => expect(engine.getState().lyrics).toEqual([
      { timeMs: 0, text: 'First line' },
      { timeMs: 2_000, text: 'Second line' },
    ]))
    expect(engine.getState().trackId).toBe('song-request:session-1')
    expect(engine.getState().status).toBe('playing')

    engine.updatePlayback({
      owner: 'song-request',
      trackId: 'session-1',
      status: 'paused',
      positionMs: 1_500,
      track,
    })
    engine.updatePlayback({
      owner: 'song-request',
      trackId: 'older-session',
      status: 'stopped',
    })

    expect(engine.getState().trackId).toBe('song-request:session-1')
    expect(engine.getState().status).toBe('paused')
    expect(engine.getState().positionMs).toBe(1_500)
  })

  it('emits a position correction when owned playback re-anchors away from the extrapolated clock', async () => {
    vi.useFakeTimers()
    try {
      const engine = setupNowPlayingEngine({
        // A single lyric line at 0s keeps the active line index stable across
        // the correction, so only the drift-emission path can surface it.
        fetchImpl: vi.fn(async () => new Response(JSON.stringify([{
          id: 1,
          trackName: track.title,
          artistName: track.artist,
          instrumental: false,
          plainLyrics: null,
          syncedLyrics: '[00:00.00]Only line',
        }]), {
          headers: { 'Content-Type': 'application/json' },
        })),
        lyricsSource: 'lrclib',
        pollIntervalMs: 1_000,
      })
      engines.push(engine)
      engine.start()

      engine.updatePlayback({
        owner: 'song-request',
        trackId: 'session-1',
        status: 'playing',
        positionMs: 0,
        track,
      })
      // Two zero-length advances yield enough event-loop turns for the mocked
      // lyrics fetch chain to settle before the drift scenario starts.
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)
      expect(engine.getState().lyrics).toHaveLength(1)

      const positions: number[] = []
      const unsubscribe = engine.subscribe(state => positions.push(state.positionMs))

      // ROOT CAUSE:
      //
      // The engine extrapolates the playback position with the wall clock
      // between renderer reports, and plain position updates are excluded
      // from the meaningful snapshot. When streamed audio buffered or
      // stalled, the next accurate report pulled the position backwards, but
      // no state was emitted, so lyric overlays kept extrapolating ahead of
      // the audible song until the next lyric line change.
      //
      // We fixed this by emitting whenever a position update contradicts the
      // extrapolation model derived from the last emitted snapshot.
      await vi.advanceTimersByTimeAsync(3_000)
      engine.updatePlayback({
        owner: 'song-request',
        trackId: 'session-1',
        status: 'playing',
        positionMs: 500,
        track,
      })

      expect(positions).toEqual([0, 500])
      unsubscribe()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('restores the active MPRIS player after a song request stops', () => {
    const externalPlayer: MprisPlayer = {
      name: 'external-player',
      playbackStatus: 'playing',
      positionMs: 12_000,
      track: {
        title: 'External Song',
        artist: 'External Artist',
        trackId: '/external/1',
      },
    }
    let listener: ((player: MprisPlayer | null) => void) | undefined
    const provider: MprisProvider = {
      start: vi.fn(async () => {}),
      stop: vi.fn(),
      getActivePlayer: () => externalPlayer,
      refresh: vi.fn(async () => listener?.(externalPlayer)),
      onActivePlayerChanged: (nextListener) => {
        listener = nextListener
        return () => {
          listener = undefined
        }
      },
    }
    const engine = setupNowPlayingEngine({
      provider,
      fetchImpl: vi.fn(async () => new Response('[]')),
      lyricsSource: 'lrclib',
    })
    engines.push(engine)
    engine.start()
    listener?.(externalPlayer)

    engine.updatePlayback({
      owner: 'song-request',
      trackId: 'session-1',
      status: 'playing',
      positionMs: 0,
      track,
    })
    expect(engine.getState().track?.title).toBe(track.title)

    engine.updatePlayback({
      owner: 'song-request',
      trackId: 'session-1',
      status: 'stopped',
    })

    expect(engine.getState().trackId).toBe('/external/1')
    expect(engine.getState().track?.title).toBe('External Song')
    expect(engine.getState().positionMs).toBe(12_000)
  })
})
