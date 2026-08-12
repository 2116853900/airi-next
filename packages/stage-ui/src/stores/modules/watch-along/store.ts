import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore, storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useVisionStore } from '../vision/store'

/**
 * Who condenses the frame observations into the spoken comment.
 *
 * - `vision`: the multimodal vision model writes a summary first, then the
 *   consciousness model reacts to that summary in character.
 * - `consciousness`: the raw observation log goes straight to the
 *   consciousness model, which summarizes and reacts in one call.
 */
export type WatchAlongSummarizerMode = 'vision' | 'consciousness'

/** Maps to a frame-difference threshold; higher sensitivity reacts to smaller changes. */
export type WatchAlongSceneChangeSensitivity = 'low' | 'medium' | 'high'

/**
 * Persisted configuration for the watch-along module.
 *
 * The capture source pair (`sourceId`, `sourceName`) is written by the
 * settings page and consumed by the main window, which owns the capture
 * stream and the engine. Cross-window sync happens through localStorage
 * storage events.
 */
export const useWatchAlongStore = defineStore('watch-along', () => {
  const visionStore = useVisionStore()
  const { configured: visionConfigured } = storeToRefs(visionStore)

  /** Whether the watch-along engine runs in the main window. */
  const enabled = useLocalStorageManualReset<boolean>('settings/watch-along/enabled', false)
  /** Desktop capturer source id of the screen or window that plays the video. */
  const sourceId = useLocalStorageManualReset<string>('settings/watch-along/source-id', '')
  /** Human-readable name of the selected source, kept for prompts and status UI. */
  const sourceName = useLocalStorageManualReset<string>('settings/watch-along/source-name', '')
  /**
   * Whether watching starts by itself when a window whose title matches
   * `autoStartKeywords` appears (video site in a browser, or a desktop
   * client). A manually selected source takes priority over auto-detection.
   */
  const autoStartEnabled = useLocalStorageManualReset<boolean>('settings/watch-along/auto-start-enabled', false)
  /** Comma-separated keywords matched against window titles, case-insensitive. */
  const autoStartKeywords = useLocalStorageManualReset<string>(
    'settings/watch-along/auto-start-keywords',
    '哔哩哔哩,bilibili,抖音,douyin,tiktok,youtube',
  )
  /** How often the engine grabs and observes one frame. */
  const captureIntervalMs = useLocalStorageManualReset<number>('settings/watch-along/capture-interval-ms', 10_000)
  /** Whether the character speaks a periodic summary of the video. */
  const periodicSummaryEnabled = useLocalStorageManualReset<boolean>('settings/watch-along/periodic-summary-enabled', true)
  /** Minimum time between two periodic summaries. */
  const summaryIntervalMs = useLocalStorageManualReset<number>('settings/watch-along/summary-interval-ms', 5 * 60_000)
  /** Whether the character reacts immediately when the picture changes a lot. */
  const sceneChangeCommentsEnabled = useLocalStorageManualReset<boolean>('settings/watch-along/scene-change-comments-enabled', true)
  const sceneChangeSensitivity = useLocalStorageManualReset<WatchAlongSceneChangeSensitivity>('settings/watch-along/scene-change-sensitivity', 'medium')
  /** Minimum time between any two spoken comments, regardless of trigger. */
  const commentCooldownMs = useLocalStorageManualReset<number>('settings/watch-along/comment-cooldown-ms', 60_000)
  const summarizerMode = useLocalStorageManualReset<WatchAlongSummarizerMode>('settings/watch-along/summarizer-mode', 'vision')

  // The module reuses the vision module's provider/model selection, so it is
  // ready as soon as a vision model exists.
  const configured = computed(() => visionConfigured.value)

  function resetState() {
    enabled.reset()
    sourceId.reset()
    sourceName.reset()
    autoStartEnabled.reset()
    autoStartKeywords.reset()
    captureIntervalMs.reset()
    periodicSummaryEnabled.reset()
    summaryIntervalMs.reset()
    sceneChangeCommentsEnabled.reset()
    sceneChangeSensitivity.reset()
    commentCooldownMs.reset()
    summarizerMode.reset()
  }

  return {
    enabled,
    sourceId,
    sourceName,
    autoStartEnabled,
    autoStartKeywords,
    captureIntervalMs,
    periodicSummaryEnabled,
    summaryIntervalMs,
    sceneChangeCommentsEnabled,
    sceneChangeSensitivity,
    commentCooldownMs,
    summarizerMode,

    configured,

    resetState,
  }
})
