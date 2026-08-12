import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'
import { computed, watch } from 'vue'

import { useVisionInference } from '../../../composables/vision'
import { getVisionWorkload } from '../../../composables/vision/use-vision-workloads'
import { useChatStore } from '../../chat'
import { useChatSessionStore } from '../../chat/session-store'
import { useConsciousnessStore } from '../consciousness'
import {
  buildObservationPrompt,
  buildObservationsSummaryMessage,
  buildSceneChangeCommentMessage,
  buildSummaryCommentMessage,
  buildVisionSummaryPrompt,
  evaluateWatchAlongTrigger,
  FRAME_STATIC_THRESHOLD,
  frameDifference,
  sceneChangeThresholdFor,
} from './decision'
import { useWatchAlongSessionStore } from './session'
import { useWatchAlongStore } from './store'

/** One captured frame handed from the app capture layer to the engine. */
export interface WatchAlongFrame {
  /** JPEG or PNG data URL sized for the vision model (about 1280x720). */
  imageDataUrl: string
  /** Downscaled grayscale pixels (0-255) used for frame-difference checks. */
  luminanceSample: number[]
  capturedAt: number
}

/**
 * Frame supplier owned by the application layer. Returns `null` when no
 * frame is available right now (stream restarting, source gone).
 */
export type WatchAlongFrameSource = () => Promise<WatchAlongFrame | null> | WatchAlongFrame | null

/**
 * After this many frame acquisitions fail in a row, the capture source is
 * considered gone (window closed, permission revoked) and the engine stops
 * with an error instead of retrying forever.
 */
const MAX_CONSECUTIVE_FRAME_FAILURES = 3

/** Caps for prompt size: summaries and scene reactions read recent history only. */
const MAX_SUMMARY_OBSERVATIONS = 30
const SCENE_CHANGE_OBSERVATION_COUNT = 3

/**
 * Drives one watch-along session: samples frames from the app-provided
 * source, observes them with the vision model, and speaks through the chat
 * pipeline when the trigger rules fire.
 *
 * Lifecycle: `start(source)` begins ticking; `stop()` halts and returns the
 * session to `idle`. A tick that is still processing suppresses the next
 * ones, so slow inference cannot stack requests. Duplicate `start` calls
 * replace the previous session.
 */
export const useWatchAlongEngineStore = defineStore('watch-along-engine', () => {
  const settings = useWatchAlongStore()
  const session = useWatchAlongSessionStore()
  const chatStore = useChatStore()
  const chatSession = useChatSessionStore()
  const consciousnessStore = useConsciousnessStore()
  const { runVisionInference } = useVisionInference()

  let intervalHandle: ReturnType<typeof setInterval> | null = null
  let acquireFrame: WatchAlongFrameSource | null = null
  let isProcessing = false
  let previousSample: number[] | null = null
  let previousObservationText: string | null = null
  let latestFrameDataUrl = ''
  // Timestamp up to which video content was already spoken about. Any
  // comment (summary or scene reaction) advances it, so one reaction also
  // resets the periodic summary window and the character does not rehash
  // the same stretch of video twice.
  let coveredUpTo = 0
  let consecutiveFrameFailures = 0

  const isRunning = computed(() => session.status === 'starting' || session.status === 'watching')

  function startTicker(intervalMs: number) {
    if (intervalHandle)
      clearInterval(intervalHandle)
    intervalHandle = setInterval(() => {
      void runTick()
    }, intervalMs)
  }

  function stopTicker() {
    if (intervalHandle)
      clearInterval(intervalHandle)
    intervalHandle = null
    acquireFrame = null
  }

  function start(source: WatchAlongFrameSource, options?: { sourceName?: string }) {
    stopTicker()

    const now = Date.now()
    session.resetSession(now)
    session.status = 'starting'
    session.activeSourceName = options?.sourceName ?? ''
    acquireFrame = source
    previousSample = null
    previousObservationText = null
    latestFrameDataUrl = ''
    coveredUpTo = now
    consecutiveFrameFailures = 0

    void runTick()
    startTicker(settings.captureIntervalMs)
  }

  function stop() {
    stopTicker()
    session.status = 'idle'
  }

  function handleFrameFailure(message: string) {
    consecutiveFrameFailures += 1
    if (consecutiveFrameFailures < MAX_CONSECUTIVE_FRAME_FAILURES)
      return

    session.lastError = message
    session.status = 'error'
    stopTicker()
  }

  async function runTick() {
    if (!acquireFrame)
      return
    if (isProcessing)
      return

    isProcessing = true
    try {
      const frame = await acquireFrame()
      if (!frame) {
        handleFrameFailure('Could not capture a frame from the selected source')
        return
      }

      consecutiveFrameFailures = 0
      if (session.status === 'starting')
        session.status = 'watching'

      // The first frame has no baseline: treat it as moving so the session
      // opens with one observation, and never as a scene change.
      const difference = previousSample ? frameDifference(previousSample, frame.luminanceSample) : null
      previousSample = frame.luminanceSample
      latestFrameDataUrl = frame.imageDataUrl

      const isStatic = difference !== null && difference < FRAME_STATIC_THRESHOLD
      const sceneChanged = difference !== null
        && difference >= sceneChangeThresholdFor(settings.sceneChangeSensitivity)

      if (!isStatic) {
        const workload = getVisionWorkload('video:watch')
        const text = await runVisionInference({
          imageDataUrl: frame.imageDataUrl,
          workloadId: 'video:watch',
          promptOverride: buildObservationPrompt(workload.prompt, previousObservationText),
        })
        previousObservationText = text
        session.pushObservation({ at: frame.capturedAt, text, sceneChanged })
        session.lastError = null
      }

      await maybeComment(sceneChanged)
    }
    catch (error) {
      session.lastError = errorMessageFrom(error) ?? 'Unknown error'
    }
    finally {
      isProcessing = false
    }
  }

  async function maybeComment(sceneChanged: boolean) {
    const now = Date.now()
    const pending = session.observationsAfter(coveredUpTo)

    const trigger = evaluateWatchAlongTrigger({
      now,
      lastCommentAt: session.lastCommentAt,
      commentCooldownMs: settings.commentCooldownMs,
      chatBusy: chatStore.sending,
      sceneChanged,
      sceneChangeCommentsEnabled: settings.sceneChangeCommentsEnabled,
      periodicSummaryEnabled: settings.periodicSummaryEnabled,
      summaryIntervalMs: settings.summaryIntervalMs,
      lastSummaryAt: coveredUpTo,
      observationsSinceSummary: pending.length,
    })
    if (trigger === 'none')
      return

    // Speaking runs through the consciousness chat pipeline; without a chat
    // model the trigger stays pending and fires once one is configured.
    if (!consciousnessStore.activeProvider || !consciousnessStore.activeModel)
      return

    let text: string
    if (trigger === 'scene-change') {
      text = buildSceneChangeCommentMessage(pending.slice(-SCENE_CHANGE_OBSERVATION_COUNT), session.activeSourceName)
    }
    else if (settings.summarizerMode === 'vision') {
      const summary = await runVisionInference({
        imageDataUrl: latestFrameDataUrl,
        workloadId: 'video:watch',
        promptOverride: buildVisionSummaryPrompt(pending.slice(-MAX_SUMMARY_OBSERVATIONS)),
      })
      session.lastSummaryText = summary
      text = buildSummaryCommentMessage(summary, session.activeSourceName)
    }
    else {
      text = buildObservationsSummaryMessage(pending.slice(-MAX_SUMMARY_OBSERVATIONS), session.activeSourceName)
    }

    await chatStore.send({
      sessionId: chatSession.activeSessionId,
      text,
    })

    const commentedAt = Date.now()
    session.lastCommentAt = commentedAt
    session.commentCount += 1
    coveredUpTo = commentedAt
  }

  watch(() => settings.captureIntervalMs, (next, previous) => {
    if (!intervalHandle)
      return
    if (next === previous)
      return

    startTicker(next)
  })

  return {
    isRunning,

    start,
    stop,
    runTick,
  }
})
