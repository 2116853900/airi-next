import type {
  SongRequestCommand,
  SongRequestEnqueueResult,
  SongRequestPlaybackPhase,
  SongRequestRequester,
  SongRequestTrack,
} from '@proj-airi/stage-shared/song-request'

/** One accepted song request and the viewer that sent it. */
export interface SongRequestQueueEntry {
  command: SongRequestCommand
  requester: SongRequestRequester
}

/** One immutable view of the active and waiting requests. */
export interface SongRequestQueueSnapshot {
  current: {
    entry: SongRequestQueueEntry
    phase: SongRequestPlaybackPhase
    track?: SongRequestTrack
  } | null
  next: SongRequestQueueEntry | null
  size: number
}

/** External operations and queue policy used by {@link SongRequestQueue}. */
export interface SongRequestQueueOptions {
  getQueueLimit: () => number
  getUserCooldownMs: () => number
  resolve: (entry: SongRequestQueueEntry, signal: AbortSignal) => Promise<SongRequestTrack>
  play: (track: SongRequestTrack, entry: SongRequestQueueEntry, signal: AbortSignal) => Promise<void>
  onResolveError?: (entry: SongRequestQueueEntry, error: unknown) => void
  onPlaybackError?: (entry: SongRequestQueueEntry, track: SongRequestTrack, error: unknown) => void
  onStateChange?: (snapshot: SongRequestQueueSnapshot) => void
  now?: () => number
}

/**
 * Resolves and plays accepted song requests in receive order.
 *
 * The active entry stays at the queue head until playback ends. Queue limits
 * therefore include requests that are resolving or playing.
 */
export class SongRequestQueue {
  private readonly entries: SongRequestQueueEntry[] = []
  private readonly lastAcceptedAt = new Map<string, number>()
  private readonly lifecycle = new AbortController()
  private currentPhase: SongRequestPlaybackPhase | undefined
  private currentTrack: SongRequestTrack | undefined
  private processing = false
  private disposed = false

  constructor(private readonly options: SongRequestQueueOptions) {}

  get size(): number {
    return this.entries.length
  }

  getSnapshot(): SongRequestQueueSnapshot {
    const currentEntry = this.entries[0]
    return {
      current: currentEntry
        ? {
            entry: currentEntry,
            phase: this.currentPhase ?? 'resolving',
            track: this.currentTrack,
          }
        : null,
      next: this.entries[1] ?? null,
      size: this.entries.length,
    }
  }

  enqueue(entry: SongRequestQueueEntry): SongRequestEnqueueResult {
    if (this.disposed)
      return { ok: false, reason: 'disposed' }

    const limit = Math.max(1, Math.floor(this.options.getQueueLimit()))
    if (this.entries.length >= limit)
      return { ok: false, reason: 'full' }

    const now = this.options.now?.() ?? Date.now()
    const cooldownMs = Math.max(0, this.options.getUserCooldownMs())
    this.pruneCooldowns(now, cooldownMs)

    const requesterKey = this.requesterKey(entry.requester)
    const acceptedAt = this.lastAcceptedAt.get(requesterKey)
    if (acceptedAt !== undefined && now - acceptedAt < cooldownMs)
      return { ok: false, reason: 'cooldown' }

    this.lastAcceptedAt.set(requesterKey, now)
    this.entries.push(entry)
    if (this.processing)
      this.emitState()
    else
      void this.drain()
    return { ok: true, position: this.entries.length }
  }

  dispose(): void {
    if (this.disposed)
      return

    this.disposed = true
    this.entries.length = 0
    this.currentPhase = undefined
    this.currentTrack = undefined
    this.lastAcceptedAt.clear()
    this.lifecycle.abort()
    this.emitState()
  }

  private requesterKey(requester: SongRequestRequester): string {
    return `${requester.platform}\u0000${requester.roomId}\u0000${requester.username}`
  }

  private pruneCooldowns(now: number, cooldownMs: number): void {
    for (const [key, acceptedAt] of this.lastAcceptedAt) {
      if (now - acceptedAt >= cooldownMs)
        this.lastAcceptedAt.delete(key)
    }
  }

  private async drain(): Promise<void> {
    if (this.processing || this.disposed)
      return

    this.processing = true
    try {
      while (!this.disposed && this.entries.length > 0) {
        const entry = this.entries[0]
        this.currentPhase = 'resolving'
        this.currentTrack = undefined
        this.emitState()
        let track: SongRequestTrack
        try {
          track = await this.options.resolve(entry, this.lifecycle.signal)
        }
        catch (error) {
          if (!this.disposed)
            this.options.onResolveError?.(entry, error)
          this.removeHead(entry)
          continue
        }

        if (this.disposed)
          break

        this.currentPhase = 'playing'
        this.currentTrack = track
        this.emitState()
        try {
          await this.options.play(track, entry, this.lifecycle.signal)
        }
        catch (error) {
          if (!this.disposed)
            this.options.onPlaybackError?.(entry, track, error)
        }
        this.removeHead(entry)
      }
    }
    finally {
      this.processing = false
    }
  }

  private removeHead(entry: SongRequestQueueEntry): void {
    if (this.entries[0] === entry) {
      this.entries.shift()
      this.currentPhase = undefined
      this.currentTrack = undefined
      this.emitState()
    }
  }

  private emitState(): void {
    this.options.onStateChange?.(this.getSnapshot())
  }
}
