import type {
  FetchLike,
  NowPlayingLyricsSourceSetting,
  NowPlayingPlaybackUpdate,
  NowPlayingState,
  NowPlayingStatus,
  NowPlayingTrack,
} from '@proj-airi/stage-shared/now-playing'

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
  updatePlayback: (playback: NowPlayingPlaybackUpdate) => void
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

// Overlays extrapolate `positionMs + (now - emittedAt)` from the last emitted
// snapshot while playing, and plain position refreshes stay quiet (see
// meaningfulSnapshot). When a re-anchor contradicts that extrapolation beyond
// this tolerance — a buffering stall, a slow stream start, or a seek within
// the same lyric line — the correction must be emitted, or overlays keep
// rendering the drifted position until the next lyric line change.
const POSITION_DRIFT_EMIT_THRESHOLD_MS = 600

type ActiveOwnedPlayback = Extract<NowPlayingPlaybackUpdate, { status: 'paused' | 'playing' }>

interface PlaybackSnapshot {
  playerName: string
  positionMs: number
  stateTrackId: string
  status: 'paused' | 'playing' | 'stopped'
  track: NowPlayingTrack
}

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
 *   -> {@link MprisProvider} or renderer-owned playback
 *     -> {@link resolveLyricsForTrack}
 *       -> subscribed renderer bridges
 */
export function setupNowPlayingEngine(options: NowPlayingEngineOptions = {}): NowPlayingEngine {
  const log = useLogg('main/now-playing/engine').useGlobalConfig()
  const { provider = null, fetchImpl, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = options
  let lyricsSource = options.lyricsSource ?? 'lrclib-netease'

  let state = createEmptyNowPlayingState()
  // Cache the serialized snapshot of `state` so each poll-driven update only
  // serializes the incoming state once instead of old + new every second.
  let stateSnapshot = meaningfulSnapshot(state)
  const listeners = new Set<(state: NowPlayingState) => void>()
  let activeTrackId: string | null = null
  let ownedPlayback: ActiveOwnedPlayback | undefined
  let positionAnchor: { positionMs: number, atMs: number } | null = null
  let lastEmit: { atMs: number, positionMs: number, status: NowPlayingStatus } | null = null
  let lyricsRequest: { trackId: string, promise: Promise<void> } | null = null
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let running = false

  function emit() {
    lastEmit = { atMs: state.updatedAt, positionMs: state.positionMs, status: state.status }
    for (const listener of listeners) {
      try {
        listener(state)
      }
      catch (error) {
        log.withError(error).warn('failed to publish now-playing state')
      }
    }
  }

  // How far the current position deviates from what overlays extrapolate
  // from the last emission (no advance is expected while not playing).
  function emittedModelDriftMs() {
    if (!lastEmit)
      return 0
    const expectedAdvanceMs = lastEmit.status === 'playing' ? state.updatedAt - lastEmit.atMs : 0
    return Math.abs(state.positionMs - (lastEmit.positionMs + expectedAdvanceMs))
  }

  function update(patch: Partial<NowPlayingState>) {
    const next = { ...state, ...patch, updatedAt: Date.now() }
    const nextSnapshot = meaningfulSnapshot(next)
    const meaningfulChanged = stateSnapshot !== nextSnapshot
    state = next
    stateSnapshot = nextSnapshot
    if (meaningfulChanged || emittedModelDriftMs() > POSITION_DRIFT_EMIT_THRESHOLD_MS)
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

  function applyPlayback(snapshot: PlaybackSnapshot) {
    positionAnchor = { positionMs: snapshot.positionMs, atMs: Date.now() }

    if (snapshot.stateTrackId !== activeTrackId) {
      activeTrackId = snapshot.stateTrackId
      update({
        trackId: snapshot.stateTrackId,
        track: snapshot.track,
        status: snapshot.status,
        playerName: snapshot.playerName,
        positionMs: snapshot.positionMs,
        lyrics: [],
        activeLineIndex: -1,
        lyricsSource: 'none',
        lyricsLoading: true,
        lyricsError: undefined,
      })
      void loadLyrics(snapshot.track)
      return
    }

    // Same track: refresh status, position, and the active line.
    const activeLineIndex = computeActiveLineIndex(state.lyrics, snapshot.positionMs)
    update({
      track: snapshot.track,
      status: snapshot.status,
      playerName: snapshot.playerName,
      positionMs: snapshot.positionMs,
      activeLineIndex,
    })
  }

  function onPlayer(player: MprisPlayer | null) {
    if (ownedPlayback)
      return

    if (!player || !player.track) {
      if (state.trackId != null || state.status !== 'stopped')
        resetToStopped(player?.name ?? null)
      return
    }

    applyPlayback({
      playerName: player.name,
      positionMs: player.positionMs,
      stateTrackId: resolveTrackId(player),
      status: player.playbackStatus,
      track: player.track,
    })
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
      if (!running)
        return

      if (ownedPlayback) {
        const positionMs = effectivePositionMs()
        update({
          positionMs,
          activeLineIndex: computeActiveLineIndex(state.lyrics, positionMs),
        })
        return
      }

      if (provider)
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
    ownedPlayback = undefined
    stopPolling()
    if (provider)
      provider.stop()
    resetToStopped(null)
  }

  function updatePlayback(playback: NowPlayingPlaybackUpdate) {
    if (!running)
      return

    if (playback.status === 'stopped') {
      // The owner and session id isolate a late stop from the next queued song.
      if (ownedPlayback?.owner !== playback.owner || ownedPlayback.trackId !== playback.trackId)
        return

      ownedPlayback = undefined
      activeTrackId = null
      positionAnchor = null
      onPlayer(provider?.getActivePlayer() ?? null)
      if (provider)
        void provider.refresh().catch(error => log.withError(error).debug('MPRIS refresh failed'))
      return
    }

    ownedPlayback = playback
    applyPlayback({
      playerName: playback.owner,
      positionMs: playback.positionMs,
      stateTrackId: `${playback.owner}:${playback.trackId}`,
      status: playback.status,
      track: playback.track,
    })
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
    updatePlayback,
    async refreshLyrics() {
      if (state.track)
        await loadLyrics(state.track, true)
    },
  }
}
