/** Owner key used when song requests publish playback to the lyrics engine. */
export const SONG_REQUEST_PLAYBACK_OWNER = 'song-request'

/** A song request parsed from one live-chat message. */
export interface SongRequestCommand {
  query: string
}

/** Identifies the viewer and live room that submitted a song request. */
export interface SongRequestRequester {
  platform: string
  roomId: string
  username: string
}

/** Request payload sent from the renderer to the desktop music service. */
export interface SongRequestResolveInput {
  query: string
}

/** A playable track resolved by the desktop music service. */
export interface SongRequestTrack {
  id: string
  title: string
  artist: string
  album?: string
  durationMs?: number
  source: string
  coverUrl?: string
  /** Capability URL for the authenticated local audio stream. */
  streamUrl: string
}

/** The result of adding one request to the playback queue. */
export type SongRequestEnqueueResult
  = | { ok: true, position: number }
    | { ok: false, reason: 'cooldown' | 'disabled' | 'disposed' | 'full' | 'invalid' }

export type SongRequestPlaybackPhase = 'playing' | 'resolving'

/** Display-safe information about one request in the playback queue. */
export interface SongRequestPlaybackItem {
  query: string
  phase: 'queued' | SongRequestPlaybackPhase
  track?: Pick<SongRequestTrack, 'artist' | 'id' | 'title'>
}

/** Runtime queue state shared between desktop renderer windows. */
export interface SongRequestPlaybackState {
  current: SongRequestPlaybackItem | null
  next: SongRequestPlaybackItem | null
  size: number
}

/**
 * Music sources that support QR-code account login. 'qq_wx' is the WeChat
 * scan flow of QQ Music; its cookie is stored under the 'qq' source.
 */
export type SongRequestLoginSource = 'netease' | 'qq' | 'qq_wx' | 'kugou' | 'bilibili'

/** One pending QR login session created by the desktop music service. */
export interface SongRequestQrLoginSession {
  source: string
  key: string
  /** QR payload to render locally; absent when the source sends an image. */
  url?: string
  /** Ready-made QR image (URL or data URI) provided by some sources. */
  imageUrl?: string
  expiresAt?: number
}

export type SongRequestQrLoginStatus = 'waiting' | 'scanned' | 'success' | 'expired' | 'failed'

export interface SongRequestQrLoginCheckResult {
  status: SongRequestQrLoginStatus
  message?: string
  /** True when a successful scan stored the account cookie on this device. */
  cookieSaved?: boolean
}

/** Which sources currently hold a saved account cookie (values never leave the sidecar). */
export interface SongRequestLoginState {
  sources: Record<string, boolean>
}

export function createEmptySongRequestLoginState(): SongRequestLoginState {
  return { sources: {} }
}

export function createEmptySongRequestPlaybackState(): SongRequestPlaybackState {
  return {
    current: null,
    next: null,
    size: 0,
  }
}
