import { Variant } from '@deltachat/dbus-next'

export type MprisPlaybackStatus = 'playing' | 'paused' | 'stopped'

/** Mapped MPRIS track metadata; null when the player exposes no usable title. */
export interface MprisTrackMetadata {
  trackId: string | null
  title: string
  artist: string
  album?: string
  durationMs?: number
  artworkUrl?: string
}

export interface MprisPlayerInfo {
  name: string
  playbackStatus: MprisPlaybackStatus
  metadata: Record<string, unknown>
}

/**
 * Recursively unwraps dbus-next `Variant` wrappers so MPRIS metadata reads
 * return plain JS values.
 */
export function unwrapVariant(value: unknown): unknown {
  if (value instanceof Variant)
    return unwrapVariant(value.value)

  if (Array.isArray(value))
    return value.map(item => unwrapVariant(item))

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0)
      return value
    return Object.fromEntries(entries.map(([key, item]) => [key, unwrapVariant(item)]))
  }

  return value
}

/**
 * Converts a D-Bus numeric value (number, bigint, Long-like, or numeric
 * string) to a JS number. Returns undefined for non-numeric input.
 */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined
  if (typeof value === 'bigint')
    return Number(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (value && typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function')
    return (value as { toNumber: () => number }).toNumber()
  return undefined
}

/** MPRIS `mpris:length` / `Position` are in microseconds; convert to ms. */
export function microsecondsToMilliseconds(value: unknown): number | undefined {
  const microseconds = toNumber(value)
  return microseconds != null && microseconds > 0 ? Math.round(microseconds / 1000) : undefined
}

/**
 * Maps raw MPRIS metadata (`Metadata` dict) to a normalized track.
 *
 * Returns null when no title is exposed (e.g. radio streams without metadata).
 *
 * @example
 * mapMprisMetadata({ 'xesam:title': 'Lights', 'xesam:artist': ['Ellie Goulding'], 'mpris:length': 210000000 })
 * // => { trackId: null, title: 'Lights', artist: 'Ellie Goulding', durationMs: 210000 }
 */
export function mapMprisMetadata(raw: Record<string, unknown>): MprisTrackMetadata | null {
  const title = typeof raw['xesam:title'] === 'string' ? raw['xesam:title'] : undefined
  if (!title)
    return null

  const artistValues = raw['xesam:artist']
  const artist = Array.isArray(artistValues)
    ? artistValues.filter((value): value is string => typeof value === 'string').join(', ')
    : typeof artistValues === 'string'
      ? artistValues
      : ''

  const album = typeof raw['xesam:album'] === 'string' ? raw['xesam:album'] : undefined
  const durationMs = microsecondsToMilliseconds(raw['mpris:length'])
  const artworkUrl = typeof raw['mpris:artUrl'] === 'string' ? raw['mpris:artUrl'] : undefined
  const trackId = typeof raw['mpris:trackid'] === 'string' ? raw['mpris:trackid'] : null

  return {
    trackId,
    title,
    artist,
    album,
    durationMs,
    artworkUrl,
  }
}

/**
 * Normalizes an MPRIS `PlaybackStatus` string into the app's status union.
 */
export function normalizePlaybackStatus(value: unknown): MprisPlaybackStatus {
  if (value === 'Playing' || value === 'playing')
    return 'playing'
  if (value === 'Paused' || value === 'paused')
    return 'paused'
  return 'stopped'
}

/**
 * Picks the active player among candidates: first `playing`, else the first
 * `paused`, else null.
 *
 * @example
 * pickActivePlayer([
 *   { name: 'vlc', playbackStatus: 'paused', metadata: {} },
 *   { name: 'spotify', playbackStatus: 'playing', metadata: {} },
 * ])
 * // => the spotify entry
 */
export function pickActivePlayer(players: MprisPlayerInfo[]): MprisPlayerInfo | null {
  if (players.length === 0)
    return null
  return players.find(player => player.playbackStatus === 'playing')
    ?? players.find(player => player.playbackStatus === 'paused')
    ?? null
}
