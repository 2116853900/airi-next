import type {
  SongRequestEnqueueResult,
  SongRequestLoginState,
  SongRequestPlaybackState,
  SongRequestQrLoginCheckResult,
  SongRequestQrLoginSession,
  SongRequestResolveInput,
  SongRequestTrack,
} from './types'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const songRequestResolveInvokeEventa = defineInvokeEventa<SongRequestTrack, SongRequestResolveInput>(
  'eventa:invoke:electron:song-request:resolve',
)

export const songRequestLoginQrCreateInvokeEventa = defineInvokeEventa<SongRequestQrLoginSession, { source: string }>(
  'eventa:invoke:electron:song-request:login-qr-create',
)

export const songRequestLoginQrCheckInvokeEventa = defineInvokeEventa<SongRequestQrLoginCheckResult, { source: string, key: string }>(
  'eventa:invoke:electron:song-request:login-qr-check',
)

export const songRequestLoginStateInvokeEventa = defineInvokeEventa<SongRequestLoginState>(
  'eventa:invoke:electron:song-request:login-state',
)

export const songRequestLoginClearInvokeEventa = defineInvokeEventa<SongRequestLoginState, { source: string }>(
  'eventa:invoke:electron:song-request:login-clear',
)

/** Cross-renderer request handled by the main Stage window that owns audio playback. */
export const songRequestSubmitTestInvokeEventa = defineInvokeEventa<SongRequestEnqueueResult, SongRequestResolveInput>(
  'eventa:invoke:song-request:submit-test',
)

export const songRequestGetPlaybackStateInvokeEventa = defineInvokeEventa<SongRequestPlaybackState>(
  'eventa:invoke:song-request:get-playback-state',
)

export const songRequestPlaybackStateChangedEventa = defineEventa<SongRequestPlaybackState>(
  'eventa:event:song-request:playback-state-changed',
)
