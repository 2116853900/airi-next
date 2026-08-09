import type { FetchLike, NowPlayingLyricsSourceSetting, NowPlayingState, NowPlayingTrack } from '@proj-airi/stage-shared/now-playing'

import type { MprisPlayer, MprisProvider } from './mpris'

import { useLogg } from '@guiiai/logg'
import { createEmptyNowPlayingState, findCurrentLineIndex, resolveLyricsForTrack } from '@proj-airi/stage-shared/now-playing'

export interface NowPlayingEngine {
  start: () => void
  stop: () => void
  getState: () => NowPlayingState
  subscribe: (listener: (state: NowPlayingState) => void) => () => void
  setEnabled: (enabled: boolean) => void
  setLyricsSource: (source: NowPlayingLyricsSourceSetting) => void
  refreshLyrics: () => Promise<void>
}

export interface NowPlayingEngineOptions {
  /** MPRIS provider; pass null on platforms without MPRIS support. */
  provider?: MprisProvider | null
  lyricsSource?: NowPlayingLyricsSourceSetting
  /** Injectable fetch for lyrics lookups (tests). */
  fetchImpl?: FetchLike
  /** How often to re-anchor playback position, in milliseconds. */
  pollIntervalMs?: number
}

const DEFAULT_POLL_INTERVAL_MS = 1_000

// Fields that, when unchanged, must NOT trigger an IPC event. Position and
// timestamps are excluded so per-second anchor refreshes stay quiet.
function meaningfulSnapshot(state: NowPlayingState) {
  return JSON.stringify({
    trackId: state.trackId,
    status: state.status,
    track: state.track,
    lyrics: state.lyrics,
    activeLineIndex: state.activeLineIndex,
    lyricsSource: state.lyricsSource,
    lyricsLoading: state.lyricsLoading,
    lyricsError: state.lyricsError,
    playerName: state.playerName,
  })
}

function resolveTrackId(player: MprisPlayer) {
  return player.track?.trackId ?? `${player.name}:${player.track?.title}:${player.track?.artist}`
}

/**
 * Owns the now-playing state and lyrics resolution for the app.
 *
 * Call stack:
 *
 * setupNowPlayingEngine
 *   -> {@link MprisProvider}
 *     -> {@link resolveLyricsForTrack}
 *       -> subscribed renderer bridges
 */
export function setupNowPlayingEngine(options: NowPlayingEngineOptions = {}): NowPlayingEngine {
  const log = useLogg('main/now-playing/engine').useGlobalConfig()
  const { provider = null, fetchImpl, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = options
  let lyricsSource = options.lyricsSource ?? 'lrclib-netease'

  let state = createEmptyNowPlayingState()
  const listeners = new Set<(state: NowPlayingState) => void>()
  let activeTrackId: string | null = null
  let positionAnchor: { positionMs: number, atMs: number } | null = null
  let lyricsRequest: { trackId: string, promise: Promise<void> } | null = null
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let running = false

  function emit() {
    for (const listener of listeners) {
      try {
        listener(state)
      }
      catch (error) {
        log.withError(error).warn('failed to publish now-playing state')
      }
    }
  }

  function update(patch: Partial<NowPlayingState>) {
    const next = { ...state, ...patch, updatedAt: Date.now() }
    const meaningfulChanged = meaningfulSnapshot(state) !== meaningfulSnapshot(next)
    state = next
    if (meaningfulChanged)
      emit()
  }

  function effectivePositionMs() {
    if (state.status !== 'playing' || !positionAnchor)
      return state.positionMs

    const extrapolated = positionAnchor.positionMs + (Date.now() - positionAnchor.atMs)
    return state.track?.durationMs != null
      ? Math.min(extrapolated, state.track.durationMs)
      : extrapolated
  }

  function computeActiveLineIndex(lyrics: NowPlayingState['lyrics'], positionMs: number) {
    return findCurrentLineIndex(lyrics, positionMs)
  }

  function resetToStopped(playerName: string | null) {
    activeTrackId = null
    positionAnchor = null
    update({
      trackId: null,
      track: null,
      status: 'stopped',
      positionMs: 0,
      lyrics: [],
      activeLineIndex: -1,
      lyricsSource: 'none',
      lyricsLoading: false,
      lyricsError: undefined,
      playerName,
    })
  }

  function onPlayer(player: MprisPlayer | null) {
    if (!player || !player.track) {
      if (state.trackId != null || state.status !== 'stopped')
        resetToStopped(player?.name ?? null)
      return
    }

    const track = player.track
    const trackId = resolveTrackId(player)
    const status = player.playbackStatus
    positionAnchor = { positionMs: player.positionMs, atMs: Date.now() }

    if (trackId !== activeTrackId) {
      activeTrackId = trackId
      update({
        trackId,
        track,
        status,
        playerName: player.name,
        positionMs: player.positionMs,
        lyrics: [],
        activeLineIndex: -1,
        lyricsSource: 'none',
        lyricsLoading: true,
        lyricsError: undefined,
      })
      void loadLyrics(track)
      return
    }

    // Same track: refresh status, position, and the active line.
    const positionMs = effectivePositionMs()
    const activeLineIndex = computeActiveLineIndex(state.lyrics, positionMs)
    update({ track, status, playerName: player.name, positionMs, activeLineIndex })
  }

  async function loadLyrics(track: NowPlayingTrack, force = false) {
    const expectedTrackId = activeTrackId
    if (expectedTrackId == null)
      return

    // Dedupe only within the same track; a track change must start a fresh
    // lookup even if a previous request is still in flight.
    if (lyricsRequest && lyricsRequest.trackId === expectedTrackId && !force)
      return lyricsRequest.promise

    const promise = (async () => {
      try {
        const result = await resolveLyricsForTrack(track, { source: lyricsSource, fetchImpl })
        if (activeTrackId !== expectedTrackId || !state.track)
          return

        const lyrics = result.lines ?? []
        update({
          lyrics,
          lyricsSource: result.source,
          lyricsLoading: false,
          lyricsError: result.error,
          activeLineIndex: computeActiveLineIndex(lyrics, effectivePositionMs()),
        })
      }
      catch (error) {
        if (activeTrackId === expectedTrackId) {
          update({ lyricsLoading: false, lyricsError: String(error) })
        }
      }
      finally {
        if (lyricsRequest?.trackId === expectedTrackId)
          lyricsRequest = null
      }
    })()

    lyricsRequest = { trackId: expectedTrackId, promise }
    return promise
  }

  function startPolling() {
    stopPolling()
    pollTimer = setInterval(() => {
      if (!provider || !running)
        return
      void provider.refresh().catch(error => log.withError(error).debug('MPRIS refresh failed'))
    }, pollIntervalMs)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }

  function start() {
    if (running)
      return
    running = true
    startPolling()
    if (provider) {
      void provider.start().catch(error => log.withError(error).warn('MPRIS provider failed to start'))
    }
  }

  function stop() {
    if (!running)
      return
    running = false
    stopPolling()
    if (provider)
      provider.stop()
    resetToStopped(null)
  }

  if (provider) {
    provider.onActivePlayerChanged((player) => {
      if (!running)
        return
      onPlayer(player)
    })
  }

  return {
    start,
    stop,
    getState() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => {
        listeners.delete(listener)
      }
    },
    setEnabled(enabled) {
      if (enabled)
        start()
      else
        stop()
    },
    setLyricsSource(source) {
      lyricsSource = source
      if (state.track)
        void loadLyrics(state.track, true)
    },
    async refreshLyrics() {
      if (state.track)
        await loadLyrics(state.track, true)
    },
  }
}
