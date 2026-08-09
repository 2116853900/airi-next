export type NowPlayingStatus = 'stopped' | 'playing' | 'paused'

export interface NowPlayingTrack {
  /** Song title, e.g. "Lights". */
  title: string
  /** Artist name, e.g. "Ellie Goulding". */
  artist: string
  /** Album name when the player exposes it. */
  album?: string
  /** Total duration in milliseconds when the player exposes it. */
  durationMs?: number
  /** Remote artwork URL exposed by the player (e.g. `mpris:artUrl`). */
  artworkUrl?: string
}

export interface NowPlayingLyricsLine {
  /** Start time of this lyric line in milliseconds from the song start. */
  timeMs: number
  /** Lyric text for this line; may be empty for instrumental pauses. */
  text: string
}

/** Which service supplied the current lyrics (or none). */
export type NowPlayingLyricsSource = 'lrclib' | 'netease' | 'none'

/** User-configured lyrics backend preference. */
export type NowPlayingLyricsSourceSetting = 'lrclib' | 'lrclib-netease'

/**
 * Snapshot of the currently playing track plus its synced lyrics.
 *
 * The engine emits a new snapshot only when something meaningful changed
 * (track, status, active lyric line, lyrics payload, or loading/error state),
 * so consumers can render without re-deriving state.
 */
export interface NowPlayingState {
  /** Stable identity of the current track (MPRIS `mpris:trackid`); null when nothing is playing. */
  trackId: string | null
  track: NowPlayingTrack | null
  status: NowPlayingStatus
  /** Current playback position in ms, best-effort extrapolated between reads. */
  positionMs: number
  /** Parsed synced lyric lines for the current track; empty when unavailable. */
  lyrics: NowPlayingLyricsLine[]
  /** Index into `lyrics` matching `positionMs`; -1 before the first line or without lyrics. */
  activeLineIndex: number
  lyricsSource: NowPlayingLyricsSource
  lyricsLoading: boolean
  /** Human-readable failure reason when the last lyrics lookup failed. */
  lyricsError?: string
  /** Name of the media player that owns the current track, e.g. "spotify". */
  playerName: string | null
  updatedAt: number
}

export function createEmptyNowPlayingState(): NowPlayingState {
  return {
    trackId: null,
    track: null,
    status: 'stopped',
    positionMs: 0,
    lyrics: [],
    activeLineIndex: -1,
    lyricsSource: 'none',
    lyricsLoading: false,
    playerName: null,
    updatedAt: 0,
  }
}
