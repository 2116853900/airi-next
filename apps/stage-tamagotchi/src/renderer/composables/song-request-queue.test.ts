import type { SongRequestTrack } from '@proj-airi/stage-shared/song-request'

import { describe, expect, it, vi } from 'vitest'

import { SongRequestQueue } from './song-request-queue'

function request(query: string, username = 'viewer') {
  return {
    command: { query },
    requester: { platform: 'bilibili', roomId: '1', username },
  }
}

function track(title: string): SongRequestTrack {
  return {
    id: title,
    title,
    artist: 'artist',
    source: 'test',
    streamUrl: `http://127.0.0.1/${title}`,
  }
}

describe('song request queue', () => {
  it('resolves and plays requests in receive order', async () => {
    const played: string[] = []
    const finishPlayback: Array<() => void> = []
    const queue = new SongRequestQueue({
      getQueueLimit: () => 3,
      getUserCooldownMs: () => 0,
      resolve: async entry => track(entry.command.query),
      play: currentTrack => new Promise<void>((resolve) => {
        played.push(currentTrack.title)
        finishPlayback.push(resolve)
      }),
    })

    expect(queue.enqueue(request('first')).ok).toBe(true)
    expect(queue.enqueue(request('second')).ok).toBe(true)
    expect(queue.enqueue(request('third')).ok).toBe(true)

    await vi.waitFor(() => expect(played).toEqual(['first']))
    finishPlayback.shift()?.()
    await vi.waitFor(() => expect(played).toEqual(['first', 'second']))
    finishPlayback.shift()?.()
    await vi.waitFor(() => expect(played).toEqual(['first', 'second', 'third']))
    finishPlayback.shift()?.()
    await vi.waitFor(() => expect(queue.size).toBe(0))
  })

  it('applies cooldown per viewer and live room', () => {
    let now = 1_000
    const queue = new SongRequestQueue({
      getQueueLimit: () => 10,
      getUserCooldownMs: () => 30_000,
      now: () => now,
      resolve: () => new Promise<SongRequestTrack>(() => {}),
      play: async () => {},
    })

    expect(queue.enqueue(request('first'))).toEqual({ ok: true, position: 1 })
    expect(queue.enqueue(request('second'))).toEqual({ ok: false, reason: 'cooldown' })
    expect(queue.enqueue(request('third', 'another-viewer')).ok).toBe(true)

    now += 30_000
    expect(queue.enqueue(request('fourth')).ok).toBe(true)
  })

  it('counts the active request toward the queue limit', async () => {
    const queue = new SongRequestQueue({
      getQueueLimit: () => 2,
      getUserCooldownMs: () => 0,
      resolve: async entry => track(entry.command.query),
      play: () => new Promise<void>(() => {}),
    })

    expect(queue.enqueue(request('playing')).ok).toBe(true)
    await vi.waitFor(() => expect(queue.size).toBe(1))
    expect(queue.enqueue(request('waiting')).ok).toBe(true)
    expect(queue.enqueue(request('rejected'))).toEqual({ ok: false, reason: 'full' })
  })

  it('reports the current request and the next request while playback advances', async () => {
    const finishPlayback: Array<() => void> = []
    const snapshots: Array<ReturnType<SongRequestQueue['getSnapshot']>> = []
    const queue = new SongRequestQueue({
      getQueueLimit: () => 3,
      getUserCooldownMs: () => 0,
      resolve: async entry => track(entry.command.query),
      play: () => new Promise<void>((resolve) => {
        finishPlayback.push(resolve)
      }),
      onStateChange: snapshot => snapshots.push(snapshot),
    })

    queue.enqueue(request('current'))
    queue.enqueue(request('next'))

    await vi.waitFor(() => {
      expect(snapshots.at(-1)?.current?.phase).toBe('playing')
      expect(snapshots.at(-1)?.current?.track?.title).toBe('current')
      expect(snapshots.at(-1)?.next?.command.query).toBe('next')
    })

    finishPlayback.shift()?.()
    await vi.waitFor(() => {
      expect(snapshots.at(-1)?.current?.track?.title).toBe('next')
      expect(snapshots.at(-1)?.next).toBeNull()
    })

    finishPlayback.shift()?.()
    await vi.waitFor(() => expect(snapshots.at(-1)?.size).toBe(0))
  })

  it('continues with the next request after resolution fails', async () => {
    const resolveError = new Error('not found')
    const onResolveError = vi.fn()
    const play = vi.fn(async () => {})
    const queue = new SongRequestQueue({
      getQueueLimit: () => 2,
      getUserCooldownMs: () => 0,
      resolve: async (entry) => {
        if (entry.command.query === 'missing')
          throw resolveError
        return track(entry.command.query)
      },
      play,
      onResolveError,
    })

    queue.enqueue(request('missing'))
    queue.enqueue(request('playable'))

    await vi.waitFor(() => expect(queue.size).toBe(0))
    expect(onResolveError).toHaveBeenCalledWith(request('missing'), resolveError)
    expect(play).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledWith(track('playable'), request('playable'), expect.any(AbortSignal))
  })

  it('aborts active work and removes pending requests on dispose', async () => {
    const resolved: string[] = []
    let activeSignal: AbortSignal | undefined
    const queue = new SongRequestQueue({
      getQueueLimit: () => 3,
      getUserCooldownMs: () => 0,
      resolve: async (entry) => {
        resolved.push(entry.command.query)
        return track(entry.command.query)
      },
      play: (_track, _entry, signal) => new Promise<void>((resolve) => {
        activeSignal = signal
        signal.addEventListener('abort', () => resolve(), { once: true })
      }),
    })

    queue.enqueue(request('active'))
    queue.enqueue(request('pending'))
    await vi.waitFor(() => expect(activeSignal).toBeDefined())

    queue.dispose()

    expect(activeSignal?.aborted).toBe(true)
    expect(queue.size).toBe(0)
    expect(queue.getSnapshot()).toEqual({ current: null, next: null, size: 0 })
    expect(queue.enqueue(request('late'))).toEqual({ ok: false, reason: 'disposed' })
    await Promise.resolve()
    expect(resolved).toEqual(['active'])
  })
})
