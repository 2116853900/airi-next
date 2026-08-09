import type { MprisPlayerInfo } from './mpris-metadata'

import { Variant } from '@deltachat/dbus-next'
import { describe, expect, it } from 'vitest'

import { mapMprisMetadata, microsecondsToMilliseconds, normalizePlaybackStatus, pickActivePlayer, toNumber, unwrapVariant } from './mpris-metadata'

// Mimics the `Long` instance dbus-next produces for 64-bit ints without adding
// a direct dependency on the `long` package.
const long = (value: number) => ({ toNumber: () => value })

describe('unwrapVariant', () => {
  it('unwraps a top-level Variant', () => {
    expect(unwrapVariant(new Variant('s', 'hello'))).toBe('hello')
  })

  it('recursively unwraps nested Variants inside arrays and dicts', () => {
    const nested = new Variant('a{sv}', {
      title: new Variant('s', 'Lights'),
      artists: new Variant('as', ['Ellie Goulding']),
    })

    expect(unwrapVariant(nested)).toEqual({
      title: 'Lights',
      artists: ['Ellie Goulding'],
    })
  })

  it('passes through plain values', () => {
    expect(unwrapVariant(42)).toBe(42)
    expect(unwrapVariant('plain')).toBe('plain')
  })
})

describe('toNumber / microsecondsToMilliseconds', () => {
  it('converts number, bigint, and Long values', () => {
    expect(toNumber(42)).toBe(42)
    expect(toNumber(42n)).toBe(42)
    expect(toNumber(long(210_000_000))).toBe(210_000_000)
    expect(toNumber('210')).toBe(210)
    expect(toNumber('not-a-number')).toBeUndefined()
  })

  it('converts microseconds to milliseconds', () => {
    expect(microsecondsToMilliseconds(210_000_000)).toBe(210_000)
    expect(microsecondsToMilliseconds(long(5_000_000))).toBe(5_000)
    expect(microsecondsToMilliseconds(0)).toBeUndefined()
    expect(microsecondsToMilliseconds(undefined)).toBeUndefined()
  })
})

describe('mapMprisMetadata', () => {
  it('maps all supported MPRIS keys and converts length to ms', () => {
    const track = mapMprisMetadata({
      'mpris:trackid': '/com/spotify/track/123',
      'xesam:title': 'Lights',
      'xesam:artist': ['Ellie Goulding', 'Guest'],
      'xesam:album': 'Lights',
      'mpris:length': long(210_000_000),
      'mpris:artUrl': 'https://example.com/art.jpg',
    })

    expect(track).toEqual({
      trackId: '/com/spotify/track/123',
      title: 'Lights',
      artist: 'Ellie Goulding, Guest',
      album: 'Lights',
      durationMs: 210_000,
      artworkUrl: 'https://example.com/art.jpg',
    })
  })

  it('treats a missing title as no metadata', () => {
    expect(mapMprisMetadata({ 'xesam:artist': ['Someone'] })).toBeNull()
  })
})

describe('normalizePlaybackStatus', () => {
  it('maps MPRIS status strings', () => {
    expect(normalizePlaybackStatus('Playing')).toBe('playing')
    expect(normalizePlaybackStatus('Paused')).toBe('paused')
    expect(normalizePlaybackStatus('Stopped')).toBe('stopped')
    expect(normalizePlaybackStatus('anything')).toBe('stopped')
  })
})

describe('pickActivePlayer', () => {
  const player = (name: string, playbackStatus: MprisPlayerInfo['playbackStatus']): MprisPlayerInfo => ({
    name,
    playbackStatus,
    metadata: {},
  })

  it('prefers a playing player over a paused one', () => {
    const picked = pickActivePlayer([player('vlc', 'paused'), player('spotify', 'playing')])

    expect(picked?.name).toBe('spotify')
  })

  it('returns null when no player is active', () => {
    expect(pickActivePlayer([player('vlc', 'stopped')])).toBeNull()
    expect(pickActivePlayer([])).toBeNull()
  })
})
