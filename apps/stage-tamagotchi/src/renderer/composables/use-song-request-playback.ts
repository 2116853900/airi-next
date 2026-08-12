import type { WebSocketEventInputLiveChat } from '@proj-airi/server-sdk'
import type { NowPlayingPlaybackUpdate } from '@proj-airi/stage-shared/now-playing'
import type {
  SongRequestCommand,
  SongRequestEnqueueResult,
  SongRequestPlaybackItem,
  SongRequestRequester,
  SongRequestTrack,
} from '@proj-airi/stage-shared/song-request'

import type { SongRequestQueueEntry, SongRequestQueueSnapshot } from './song-request-queue'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { nowPlayingUpdatePlaybackInvokeEventa } from '@proj-airi/stage-shared/now-playing'
import {
  createEmptySongRequestPlaybackState,
  getSongRequestBusContext,
  parseSongRequestCommand,
  SONG_REQUEST_PLAYBACK_OWNER,
  songRequestGetPlaybackStateInvokeEventa,
  songRequestPlaybackStateChangedEventa,
  songRequestResolveInvokeEventa,
  songRequestSubmitTestInvokeEventa,
} from '@proj-airi/stage-shared/song-request'
import { useSettingsLiveChat } from '@proj-airi/stage-ui/stores/settings'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { SongRequestQueue } from './song-request-queue'

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume))
}

// Cadence for re-reporting the true audio position while playing. The lyrics
// engine extrapolates the position with the wall clock between reports, so a
// streamed track that buffers slowly or stalls drifts ahead of the audio
// unless the real `audio.currentTime` re-anchors it periodically.
const POSITION_REPORT_INTERVAL_MS = 1_000

/** Owns live-chat song request parsing, FIFO playback, and desktop media controls. */
export function useSongRequestPlayback() {
  const { t } = useI18n()
  const settings = useSettingsLiveChat()
  const {
    songRequestEnabled,
    songRequestQueueLimit,
    songRequestUserCooldownMs,
    songRequestVolume,
  } = storeToRefs(settings)
  const resolveTrack = useElectronEventaInvoke(songRequestResolveInvokeEventa)
  const updateNowPlayingPlayback = useElectronEventaInvoke(nowPlayingUpdatePlaybackInvokeEventa)
  const songRequestBus = getSongRequestBusContext()
  const audio = new Audio()
  audio.preload = 'none'
  audio.volume = clampVolume(songRequestVolume.value)

  let finishPlayback: ((error?: unknown) => void) | undefined
  let playbackSequence = 0
  let testRequesterSequence = 0
  let activePlayback: { sessionId: string, track: SongRequestTrack } | undefined
  let playbackState = createEmptySongRequestPlaybackState()
  let playbackUpdateChain = Promise.resolve()

  function publishLyricsPlayback(playback: NowPlayingPlaybackUpdate): void {
    // Eventa does not serialize concurrent invokes. Keep play, pause, seek, and
    // stop updates ordered so a late play cannot restore an ended track.
    playbackUpdateChain = playbackUpdateChain
      .then(() => updateNowPlayingPlayback(playback))
      .catch(error => console.warn('[song-request] failed to update lyrics playback:', errorMessageFrom(error)))
  }

  function reportPlayback(status: 'paused' | 'playing'): void {
    const playback = activePlayback
    if (!playback)
      return

    publishLyricsPlayback({
      owner: SONG_REQUEST_PLAYBACK_OWNER,
      trackId: playback.sessionId,
      status,
      positionMs: Math.max(0, audio.currentTime * 1000),
      track: {
        title: playback.track.title,
        artist: playback.track.artist,
        album: playback.track.album,
        durationMs: playback.track.durationMs,
        artworkUrl: playback.track.coverUrl,
      },
    })
  }

  function clearReportedPlayback(): void {
    const playback = activePlayback
    activePlayback = undefined
    if (!playback)
      return

    publishLyricsPlayback({
      owner: SONG_REQUEST_PLAYBACK_OWNER,
      trackId: playback.sessionId,
      status: 'stopped',
    })
  }

  function clearAudioSource(): void {
    clearReportedPlayback()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
    }
  }

  function updateMediaMetadata(track: SongRequestTrack): void {
    if (!navigator.mediaSession || typeof MediaMetadata === 'undefined')
      return

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.coverUrl ? [{ src: track.coverUrl }] : undefined,
    })
  }

  function playTrack(track: SongRequestTrack, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        resolve()
        return
      }

      let settled = false
      const playbackListeners = new AbortController()
      const finish = (error?: unknown) => {
        if (settled)
          return
        settled = true
        playbackListeners.abort()
        if (finishPlayback === finish)
          finishPlayback = undefined
        clearAudioSource()
        if (error)
          reject(error)
        else
          resolve()
      }

      finishPlayback = finish
      audio.addEventListener('ended', () => finish(), { once: true, signal: playbackListeners.signal })
      audio.addEventListener('error', () => finish(new Error(t('settings.pages.modules.live_chat.sections.song_request.messages.stream_failed'))), { once: true, signal: playbackListeners.signal })
      signal.addEventListener('abort', () => finish(), { once: true, signal: playbackListeners.signal })
      playbackSequence += 1
      activePlayback = {
        sessionId: `${track.source}:${track.id}:${playbackSequence}`,
        track,
      }
      audio.src = track.streamUrl
      updateMediaMetadata(track)
      void audio.play()
        .then(() => {
          toast.success(t('settings.pages.modules.live_chat.sections.song_request.messages.now_playing', {
            artist: track.artist,
            title: track.title,
          }))
        })
        .catch(error => finish(error))
    })
  }

  const queue = new SongRequestQueue({
    getQueueLimit: () => songRequestQueueLimit.value,
    getUserCooldownMs: () => songRequestUserCooldownMs.value,
    resolve: entry => resolveTrack({ query: entry.command.query }),
    play: (track, _entry, signal) => playTrack(track, signal),
    onResolveError: (entry, error) => {
      toast.error(t('settings.pages.modules.live_chat.sections.song_request.messages.resolve_failed', {
        error: errorMessageFrom(error) ?? t('settings.pages.modules.live_chat.sections.song_request.messages.unknown_error'),
        query: entry.command.query,
      }))
    },
    onPlaybackError: (_entry, track, error) => {
      toast.error(t('settings.pages.modules.live_chat.sections.song_request.messages.playback_failed', {
        error: errorMessageFrom(error) ?? t('settings.pages.modules.live_chat.sections.song_request.messages.unknown_error'),
        title: track.title,
      }))
    },
    onStateChange: publishPlaybackState,
  })

  function toPlaybackItem(
    entry: SongRequestQueueEntry,
    phase: SongRequestPlaybackItem['phase'],
    track?: SongRequestTrack,
  ): SongRequestPlaybackItem {
    return {
      query: entry.command.query,
      phase,
      track: track
        ? {
            id: track.id,
            title: track.title,
            artist: track.artist,
          }
        : undefined,
    }
  }

  function publishPlaybackState(snapshot: SongRequestQueueSnapshot): void {
    playbackState = {
      current: snapshot.current
        ? toPlaybackItem(snapshot.current.entry, snapshot.current.phase, snapshot.current.track)
        : null,
      next: snapshot.next ? toPlaybackItem(snapshot.next, 'queued') : null,
      size: snapshot.size,
    }
    void songRequestBus.emit(songRequestPlaybackStateChangedEventa, playbackState)
      .catch(error => console.warn('[song-request] failed to publish queue state:', errorMessageFrom(error)))
  }

  function enqueue(command: SongRequestCommand, requester: SongRequestRequester): SongRequestEnqueueResult {
    return queue.enqueue({ command, requester })
  }

  const removeGetPlaybackStateHandler = defineInvokeHandler(
    songRequestBus,
    songRequestGetPlaybackStateInvokeEventa,
    () => playbackState,
  )
  const removeSubmitTestHandler = defineInvokeHandler(
    songRequestBus,
    songRequestSubmitTestInvokeEventa,
    (input) => {
      if (!songRequestEnabled.value)
        return { ok: false, reason: 'disabled' }

      const command = parseSongRequestCommand(`点歌 ${input.query}`)
      if (!command)
        return { ok: false, reason: 'invalid' }

      testRequesterSequence += 1
      return enqueue(command, {
        platform: 'manual-test',
        roomId: 'settings',
        username: `manual-test-${testRequesterSequence}`,
      })
    },
  )

  const stopVolumeWatch = watch(songRequestVolume, (volume) => {
    audio.volume = clampVolume(volume)
  })

  function handleAudioPlay(): void {
    if (navigator.mediaSession)
      navigator.mediaSession.playbackState = 'playing'
    reportPlayback('playing')
  }

  function handleAudioPause(): void {
    if (navigator.mediaSession)
      navigator.mediaSession.playbackState = audio.src ? 'paused' : 'none'
    reportPlayback('paused')
  }

  function handleAudioSeeked(): void {
    reportPlayback(audio.paused ? 'paused' : 'playing')
  }

  let lastPositionReportAtMs = 0

  function handleAudioTimeUpdate(): void {
    if (audio.paused)
      return
    const now = Date.now()
    if (now - lastPositionReportAtMs < POSITION_REPORT_INTERVAL_MS)
      return
    lastPositionReportAtMs = now
    reportPlayback('playing')
  }

  function handleAudioPlaying(): void {
    // Fires when playback truly starts or resumes after buffering; the 'play'
    // event alone anchors the lyrics clock before any audio is audible.
    lastPositionReportAtMs = Date.now()
    reportPlayback('playing')
  }

  function handleAudioWaiting(): void {
    // The stream ran out of data. Freeze the lyrics clock at the stalled
    // position instead of letting it extrapolate ahead of the audio; the
    // next 'playing' event resumes it from the true position.
    reportPlayback('paused')
  }

  audio.addEventListener('play', handleAudioPlay)
  audio.addEventListener('pause', handleAudioPause)
  audio.addEventListener('seeked', handleAudioSeeked)
  audio.addEventListener('timeupdate', handleAudioTimeUpdate)
  audio.addEventListener('playing', handleAudioPlaying)
  audio.addEventListener('waiting', handleAudioWaiting)

  function setMediaSessionActions(): void {
    if (!navigator.mediaSession)
      return

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        void audio.play().catch((error) => {
          toast.error(errorMessageFrom(error) ?? t('settings.pages.modules.live_chat.sections.song_request.messages.playback_failed_short'))
        })
      })
      navigator.mediaSession.setActionHandler('pause', () => audio.pause())
      navigator.mediaSession.setActionHandler('nexttrack', () => finishPlayback?.())
    }
    catch (error) {
      console.warn('[song-request] media session actions are unavailable:', errorMessageFrom(error))
    }
  }

  function clearMediaSession(): void {
    if (!navigator.mediaSession)
      return

    for (const action of ['play', 'pause', 'nexttrack'] as const) {
      try {
        navigator.mediaSession.setActionHandler(action, null)
      }
      catch {
        // Some platforms expose Media Session but do not support every action.
      }
    }
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
  }

  setMediaSessionActions()

  function handleLiveChatMessage(message: WebSocketEventInputLiveChat): boolean {
    const command = parseSongRequestCommand(message.text)
    if (!command)
      return false
    if (!songRequestEnabled.value)
      return true

    const result = enqueue(command, {
      platform: message.platform,
      roomId: String(message.roomId),
      username: message.username,
    })
    if (result.ok) {
      toast.success(t('settings.pages.modules.live_chat.sections.song_request.messages.accepted', {
        position: result.position,
        query: command.query,
      }))
      return true
    }

    if (result.reason === 'full') {
      toast.error(t('settings.pages.modules.live_chat.sections.song_request.messages.queue_full'))
    }
    else if (result.reason === 'cooldown') {
      toast.error(t('settings.pages.modules.live_chat.sections.song_request.messages.cooldown'))
    }
    return true
  }

  function dispose(): void {
    queue.dispose()
    removeGetPlaybackStateHandler()
    removeSubmitTestHandler()
    finishPlayback?.()
    finishPlayback = undefined
    stopVolumeWatch()
    audio.removeEventListener('play', handleAudioPlay)
    audio.removeEventListener('pause', handleAudioPause)
    audio.removeEventListener('seeked', handleAudioSeeked)
    audio.removeEventListener('timeupdate', handleAudioTimeUpdate)
    audio.removeEventListener('playing', handleAudioPlaying)
    audio.removeEventListener('waiting', handleAudioWaiting)
    clearAudioSource()
    clearMediaSession()
  }

  return {
    handleLiveChatMessage,
    dispose,
  }
}
