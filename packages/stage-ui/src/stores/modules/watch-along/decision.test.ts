import type { WatchAlongObservation, WatchAlongTriggerInput } from './decision'

import { describe, expect, it } from 'vitest'

import {
  buildObservationPrompt,
  buildObservationsSummaryMessage,
  buildSceneChangeCommentMessage,
  buildSummaryCommentMessage,
  buildVisionSummaryPrompt,
  evaluateWatchAlongTrigger,
  frameDifference,
  matchWatchTarget,
  parseWatchTargetKeywords,
  sceneChangeThresholdFor,
  trimObservations,
} from './decision'

function observation(at: number, text = 'A cat walks across the room.'): WatchAlongObservation {
  return { at, text, sceneChanged: false }
}

function triggerInput(overrides: Partial<WatchAlongTriggerInput> = {}): WatchAlongTriggerInput {
  return {
    now: 1_000_000,
    lastCommentAt: null,
    commentCooldownMs: 60_000,
    chatBusy: false,
    sceneChanged: false,
    sceneChangeCommentsEnabled: true,
    periodicSummaryEnabled: true,
    summaryIntervalMs: 300_000,
    lastSummaryAt: 1_000_000 - 300_000,
    observationsSinceSummary: 3,
    ...overrides,
  }
}

describe('frameDifference', () => {
  it('returns 0 for identical samples', () => {
    expect(frameDifference([0, 128, 255], [0, 128, 255])).toBe(0)
  })

  it('returns 1 for a full black-to-white inversion', () => {
    expect(frameDifference([0, 0, 0], [255, 255, 255])).toBe(1)
  })

  it('returns the normalized mean difference for partial changes', () => {
    // Two of four pixels move by 51 (= 0.2 of 255): mean = 0.1.
    expect(frameDifference([0, 0, 100, 100], [0, 0, 151, 151])).toBeCloseTo(0.1, 5)
  })

  it('treats samples of different lengths as a full change', () => {
    expect(frameDifference([0, 0], [0, 0, 0])).toBe(1)
  })

  it('treats empty samples as a full change', () => {
    expect(frameDifference([], [0, 0])).toBe(1)
  })
})

describe('sceneChangeThresholdFor', () => {
  it('needs a larger difference at lower sensitivity', () => {
    expect(sceneChangeThresholdFor('low')).toBeGreaterThan(sceneChangeThresholdFor('medium'))
    expect(sceneChangeThresholdFor('medium')).toBeGreaterThan(sceneChangeThresholdFor('high'))
  })
})

describe('trimObservations', () => {
  it('drops the oldest entries beyond the count limit', () => {
    const entries = [observation(1), observation(2), observation(3)]
    const trimmed = trimObservations(entries, { maxEntries: 2, maxAgeMs: 100, now: 3 })

    expect(trimmed).toHaveLength(2)
    expect(trimmed[0]?.at).toBe(2)
    expect(trimmed[1]?.at).toBe(3)
  })

  it('drops entries older than the age limit', () => {
    const entries = [observation(0), observation(500), observation(900)]
    const trimmed = trimObservations(entries, { maxEntries: 10, maxAgeMs: 500, now: 1_000 })

    expect(trimmed).toHaveLength(2)
    expect(trimmed[0]?.at).toBe(500)
  })

  it('keeps the input array untouched', () => {
    const entries = [observation(1), observation(2)]
    trimObservations(entries, { maxEntries: 1, maxAgeMs: 100, now: 2 })

    expect(entries).toHaveLength(2)
  })
})

describe('evaluateWatchAlongTrigger', () => {
  it('stays silent while the chat pipeline is busy', () => {
    expect(evaluateWatchAlongTrigger(triggerInput({ chatBusy: true, sceneChanged: true }))).toBe('none')
  })

  it('stays silent during the comment cooldown', () => {
    const input = triggerInput({
      sceneChanged: true,
      lastCommentAt: 1_000_000 - 30_000,
      commentCooldownMs: 60_000,
    })

    expect(evaluateWatchAlongTrigger(input)).toBe('none')
  })

  it('prefers a scene change over a due summary', () => {
    expect(evaluateWatchAlongTrigger(triggerInput({ sceneChanged: true }))).toBe('scene-change')
  })

  it('ignores scene changes when the toggle is off', () => {
    const input = triggerInput({ sceneChanged: true, sceneChangeCommentsEnabled: false })

    expect(evaluateWatchAlongTrigger(input)).toBe('summary')
  })

  it('fires a summary once the interval elapsed', () => {
    expect(evaluateWatchAlongTrigger(triggerInput())).toBe('summary')
  })

  it('waits while the summary interval has not elapsed', () => {
    const input = triggerInput({ lastSummaryAt: 1_000_000 - 100_000, summaryIntervalMs: 300_000 })

    expect(evaluateWatchAlongTrigger(input)).toBe('none')
  })

  it('skips the summary when the toggle is off', () => {
    expect(evaluateWatchAlongTrigger(triggerInput({ periodicSummaryEnabled: false }))).toBe('none')
  })

  it('stays silent without new observations', () => {
    const input = triggerInput({ sceneChanged: true, observationsSinceSummary: 0 })

    expect(evaluateWatchAlongTrigger(input)).toBe('none')
  })

  it('allows the first comment when lastCommentAt is null', () => {
    expect(evaluateWatchAlongTrigger(triggerInput({ lastCommentAt: null }))).toBe('summary')
  })
})

describe('parseWatchTargetKeywords', () => {
  it('splits on Latin and Chinese separators and lowercases', () => {
    expect(parseWatchTargetKeywords('Bilibili，抖音、TikTok, YouTube')).toEqual(['bilibili', '抖音', 'tiktok', 'youtube'])
  })

  it('drops empty entries', () => {
    expect(parseWatchTargetKeywords(' , ，、')).toEqual([])
  })
})

describe('matchWatchTarget', () => {
  const sources = [
    { id: 'window:1', name: 'Untitled - Notepad' },
    { id: 'window:2', name: '【4K】猫猫合集_哔哩哔哩_bilibili - Google Chrome' },
    { id: 'window:3', name: '抖音' },
  ]

  it('matches window titles case-insensitively', () => {
    expect(matchWatchTarget(sources, ['bilibili'])?.id).toBe('window:2')
  })

  it('matches desktop client names', () => {
    expect(matchWatchTarget(sources, ['抖音'])?.id).toBe('window:3')
  })

  it('returns null when nothing matches', () => {
    expect(matchWatchTarget(sources, ['netflix'])).toBeNull()
  })

  it('returns null without keywords', () => {
    expect(matchWatchTarget(sources, [])).toBeNull()
  })

  it('keeps the currently watched window when it still matches', () => {
    const target = matchWatchTarget(sources, ['bilibili', '抖音'], 'window:3')

    expect(target?.id).toBe('window:3')
  })

  it('falls back to the first match when the preferred window is gone', () => {
    const target = matchWatchTarget(sources, ['bilibili', '抖音'], 'window:9')

    expect(target?.id).toBe('window:2')
  })
})

describe('prompt and message builders', () => {
  it('returns the base prompt for the first observation', () => {
    expect(buildObservationPrompt('Base prompt.', null)).toBe('Base prompt.')
  })

  it('appends the previous observation for continuity', () => {
    const prompt = buildObservationPrompt('Base prompt.', 'A cat sits on a sofa.')

    expect(prompt).toContain('Base prompt.')
    expect(prompt).toContain('Previous frame observation: A cat sits on a sofa.')
  })

  it('lists observations oldest first in the vision summary prompt', () => {
    const prompt = buildVisionSummaryPrompt([
      observation(0, 'First event.'),
      observation(1, 'Second event.'),
    ])

    expect(prompt.indexOf('First event.')).toBeLessThan(prompt.indexOf('Second event.'))
    expect(prompt).toContain('2-4 sentences')
  })

  it('includes the summary and the source name in the summary comment message', () => {
    const message = buildSummaryCommentMessage('The cat found its owner.', 'My Player')

    expect(message).toContain('The cat found its owner.')
    expect(message).toContain('"My Player"')
  })

  it('falls back to a generic source description without a source name', () => {
    const message = buildSummaryCommentMessage('The cat found its owner.', '')

    expect(message).toContain('watching a video together')
  })

  it('carries observations into the consciousness summary message', () => {
    const message = buildObservationsSummaryMessage([observation(0, 'A dog barks.')], 'Browser')

    expect(message).toContain('A dog barks.')
    expect(message).toContain('Summarize for your user')
  })

  it('carries observations into the scene-change message', () => {
    const message = buildSceneChangeCommentMessage([observation(0, 'The screen cuts to a stage.')], '')

    expect(message).toContain('The screen cuts to a stage.')
    expect(message).toContain('just changed')
  })
})
