import { describe, expect, it } from 'vitest'

import { findCurrentLineIndex, parseLrc } from './lrc'

describe('parseLrc', () => {
  it('parses standard [mm:ss.xx] timestamps with hundredths of a second', () => {
    const lines = parseLrc('[00:12.34]Hello\n[01:05.00]World')

    expect(lines).toEqual([
      { timeMs: 12_340, text: 'Hello' },
      { timeMs: 65_000, text: 'World' },
    ])
  })

  it('normalizes tenths and NetEase-style millisecond fractions', () => {
    const lines = parseLrc('[00:12.5]Tenth\n[00:12.50]Hundredth\n[00:12.500]Millisecond')

    expect(lines.map(line => line.timeMs)).toEqual([12_500, 12_500, 12_500])
  })

  it('supports timestamps without a fractional part', () => {
    expect(parseLrc('[00:12]Plain')).toEqual([{ timeMs: 12_000, text: 'Plain' }])
  })

  it('expands a multi-timestamp line once per timestamp', () => {
    const lines = parseLrc('[00:12.00][00:24.00]Chorus')

    expect(lines).toEqual([
      { timeMs: 12_000, text: 'Chorus' },
      { timeMs: 24_000, text: 'Chorus' },
    ])
  })

  it('skips metadata tags and timestamp-less lines', () => {
    const lines = parseLrc('[ti:Title]\n[ar:Artist]\n[offset:500]\nSome header text\n[00:12.00]First')

    expect(lines).toEqual([{ timeMs: 12_000, text: 'First' }])
  })

  it('sorts out-of-order lines by start time', () => {
    const lines = parseLrc('[00:30.00]Later\n[00:10.00]Earlier')

    expect(lines.map(line => line.timeMs)).toEqual([10_000, 30_000])
  })

  it('keeps empty lyric text for instrumental pauses', () => {
    const lines = parseLrc('[00:12.00]\n[00:20.00]Sing')

    expect(lines).toEqual([
      { timeMs: 12_000, text: '' },
      { timeMs: 20_000, text: 'Sing' },
    ])
  })

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(parseLrc('')).toEqual([])
    expect(parseLrc('   \n  \n')).toEqual([])
  })
})

describe('findCurrentLineIndex', () => {
  const lines = parseLrc('[00:10.00]A\n[00:20.00]B\n[00:20.00]C')

  it('returns -1 for empty lyrics', () => {
    expect(findCurrentLineIndex([], 5_000)).toBe(-1)
  })

  it('returns -1 before the first line starts', () => {
    expect(findCurrentLineIndex(lines, 9_999)).toBe(-1)
  })

  it('matches the exact start of a line', () => {
    expect(findCurrentLineIndex(lines, 10_000)).toBe(0)
  })

  it('returns the active line between two lines', () => {
    expect(findCurrentLineIndex(lines, 15_000)).toBe(0)
  })

  it('keeps the last line index for repeated timestamps', () => {
    expect(findCurrentLineIndex(lines, 20_000)).toBe(2)
  })

  it('stays on the final line past the last timestamp', () => {
    expect(findCurrentLineIndex(lines, 99_999)).toBe(2)
  })
})
