import type { WatchAlongSceneChangeSensitivity } from './store'

/** One vision-model observation of a captured video frame. */
export interface WatchAlongObservation {
  /** Capture timestamp in epoch milliseconds. */
  at: number
  /** Short factual description produced by the vision model. */
  text: string
  /** Whether the frame difference marked this frame as a scene change. */
  sceneChanged: boolean
}

/**
 * Mean absolute luminance difference below this value means the picture did
 * not move (paused video, static screen). The engine skips vision inference
 * for such frames to save local GPU time.
 */
export const FRAME_STATIC_THRESHOLD = 0.015

/**
 * Frame-difference thresholds above which a frame counts as a scene change.
 * Lower sensitivity needs a larger difference before the character reacts.
 */
const SCENE_CHANGE_THRESHOLDS: Record<WatchAlongSceneChangeSensitivity, number> = {
  low: 0.5,
  medium: 0.35,
  high: 0.22,
}

export function sceneChangeThresholdFor(sensitivity: WatchAlongSceneChangeSensitivity): number {
  return SCENE_CHANGE_THRESHOLDS[sensitivity]
}

/**
 * Compares two downscaled grayscale samples of consecutive frames.
 *
 * Returns the mean absolute difference normalized to `0..1`, where `0` means
 * identical pictures and `1` means full black-to-white inversion. Samples of
 * different lengths (resolution change, source switch) count as a full
 * change because the pixels cannot be compared pairwise.
 *
 * @example
 * frameDifference([0, 128, 255], [0, 128, 255])
 * // => 0
 */
export function frameDifference(previous: readonly number[], next: readonly number[]): number {
  if (previous.length === 0 || next.length === 0)
    return 1
  if (previous.length !== next.length)
    return 1

  let total = 0
  for (let index = 0; index < previous.length; index += 1)
    total += Math.abs(previous[index] - next[index])

  return total / previous.length / 255
}

export interface TrimObservationsOptions {
  /** Upper bound on kept entries; oldest entries drop first. */
  maxEntries: number
  /** Entries older than this age drop even when the count is small. */
  maxAgeMs: number
  now: number
}

/**
 * Bounds the observation log by count and by age so long watch sessions do
 * not grow memory or prompt size without limit. Returns a new array.
 */
export function trimObservations(
  observations: readonly WatchAlongObservation[],
  options: TrimObservationsOptions,
): WatchAlongObservation[] {
  const cutoff = options.now - options.maxAgeMs
  const fresh = observations.filter(observation => observation.at >= cutoff)
  return fresh.slice(Math.max(0, fresh.length - options.maxEntries))
}

export interface WatchAlongTriggerInput {
  now: number
  /** Epoch ms of the last spoken comment, or `null` before the first one. */
  lastCommentAt: number | null
  commentCooldownMs: number
  /** True while the chat pipeline streams another response. */
  chatBusy: boolean
  /** True when the newest observed frame crossed the scene-change threshold. */
  sceneChanged: boolean
  sceneChangeCommentsEnabled: boolean
  periodicSummaryEnabled: boolean
  summaryIntervalMs: number
  /**
   * Epoch ms of the last summary comment. The engine seeds this with the
   * watch start time so the first summary waits one full interval.
   */
  lastSummaryAt: number
  /** Number of observations collected since the last summary. */
  observationsSinceSummary: number
}

export type WatchAlongTriggerKind = 'none' | 'scene-change' | 'summary'

/**
 * Decides whether the character speaks now and why.
 *
 * Precedence: a scene change beats a due summary because it reacts to what
 * happens on screen right now, while the summary can wait for the next tick.
 * Both respect the shared comment cooldown, and nothing fires while the chat
 * pipeline is busy — a deferred trigger fires on a later tick instead.
 */
export function evaluateWatchAlongTrigger(input: WatchAlongTriggerInput): WatchAlongTriggerKind {
  if (input.chatBusy)
    return 'none'

  const coolingDown = input.lastCommentAt !== null
    && input.now - input.lastCommentAt < input.commentCooldownMs
  if (coolingDown)
    return 'none'

  if (input.sceneChangeCommentsEnabled && input.sceneChanged && input.observationsSinceSummary > 0)
    return 'scene-change'

  const summaryDue = input.periodicSummaryEnabled
    && input.observationsSinceSummary > 0
    && input.now - input.lastSummaryAt >= input.summaryIntervalMs
  if (summaryDue)
    return 'summary'

  return 'none'
}

/** One capturable window as reported by the desktop capturer. */
export interface WatchTargetCandidate {
  id: string
  name: string
}

/**
 * Normalizes the auto-start keyword setting into matchable keywords.
 * Accepts Latin and Chinese list separators.
 *
 * @example
 * parseWatchTargetKeywords('bilibili，抖音, ,TikTok')
 * // => ['bilibili', '抖音', 'tiktok']
 */
export function parseWatchTargetKeywords(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map(keyword => keyword.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Picks the window that the auto-start feature should watch.
 *
 * Window titles carry the page or app name for both browser tabs
 * ("...哔哩哔哩_bilibili - Chrome") and desktop clients ("抖音"), so a
 * case-insensitive title match covers both watch scenarios. When the
 * currently watched window still matches, it wins over other candidates so
 * the capture does not hop between windows.
 */
export function matchWatchTarget(
  sources: readonly WatchTargetCandidate[],
  keywords: readonly string[],
  preferredId: string | null = null,
): WatchTargetCandidate | null {
  if (keywords.length === 0)
    return null

  const matches = sources.filter((source) => {
    const name = source.name.toLowerCase()
    return keywords.some(keyword => name.includes(keyword))
  })
  if (matches.length === 0)
    return null

  if (preferredId) {
    const preferred = matches.find(source => source.id === preferredId)
    if (preferred)
      return preferred
  }
  return matches[0]
}

function formatObservationLine(observation: WatchAlongObservation): string {
  const time = new Date(observation.at).toTimeString().slice(0, 8)
  return `- [${time}] ${observation.text}`
}

function formatObservationLines(observations: readonly WatchAlongObservation[]): string {
  return observations.map(formatObservationLine).join('\n')
}

function describeSource(sourceName: string): string {
  return sourceName ? `a video ("${sourceName}")` : 'a video'
}

/**
 * Builds the per-frame observation prompt. The previous observation rides
 * along so the vision model keeps temporal continuity and does not repeat
 * unchanged details on every frame.
 */
export function buildObservationPrompt(basePrompt: string, previousObservation: string | null): string {
  if (!previousObservation)
    return basePrompt

  return [
    basePrompt,
    '',
    `Previous frame observation: ${previousObservation}`,
    'Focus on what changed since that observation.',
  ].join('\n')
}

/**
 * Builds the summarization prompt for the vision model (summarizer mode
 * `vision`). The latest frame image accompanies this prompt so the model can
 * anchor the summary in what is on screen right now.
 */
export function buildVisionSummaryPrompt(observations: readonly WatchAlongObservation[]): string {
  return [
    'You watched a video through periodic frame observations.',
    'The attached image is the latest frame.',
    'Observations, oldest first:',
    formatObservationLines(observations),
    '',
    'Write a short factual summary (2-4 sentences) of what happened in the video.',
    'Name the video if the observations identify it.',
    'Do not mention frames, observations, or captures.',
  ].join('\n')
}

/**
 * Builds the chat message for a periodic summary when the vision model
 * already condensed the observations (summarizer mode `vision`).
 */
export function buildSummaryCommentMessage(summary: string, sourceName: string): string {
  return [
    `[Watch-along] You are watching ${describeSource(sourceName)} together with your user.`,
    'Here is what happened in the video recently:',
    summary,
    '',
    'Share a short reaction with your user in your own voice, a few sentences at most.',
    'Mention what happened so your user can follow, but do not repeat the text above verbatim.',
  ].join('\n')
}

/**
 * Builds the chat message for a periodic summary from raw observations
 * (summarizer mode `consciousness`): the consciousness model summarizes and
 * reacts in one call.
 */
export function buildObservationsSummaryMessage(
  observations: readonly WatchAlongObservation[],
  sourceName: string,
): string {
  return [
    `[Watch-along] You are watching ${describeSource(sourceName)} together with your user.`,
    'Frame observations since your last comment, oldest first:',
    formatObservationLines(observations),
    '',
    'Summarize for your user what happened in the video, in your own voice, and add one short reaction.',
    'Keep it to a few sentences. Do not list the observations back or mention frames.',
  ].join('\n')
}

/** Builds the chat message for an immediate scene-change reaction. */
export function buildSceneChangeCommentMessage(
  observations: readonly WatchAlongObservation[],
  sourceName: string,
): string {
  return [
    `[Watch-along] You are watching ${describeSource(sourceName)} together with your user.`,
    'The picture just changed a lot. Recent frame observations, oldest first:',
    formatObservationLines(observations),
    '',
    'React to what happens on screen right now, in your own voice, in one or two short sentences.',
    'Do not list the observations back or mention frames.',
  ].join('\n')
}
