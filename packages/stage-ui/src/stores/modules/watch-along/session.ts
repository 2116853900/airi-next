import type { WatchAlongObservation } from './decision'

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { trimObservations } from './decision'

export type WatchAlongStatus = 'idle' | 'starting' | 'watching' | 'error'

/**
 * Bounds for the in-memory observation log. 60 entries at the default 10 s
 * capture interval cover 10 minutes of video; the age bound keeps stale
 * content out of prompts when captures run slower than the interval.
 */
const OBSERVATION_LOG_MAX_ENTRIES = 60
const OBSERVATION_LOG_MAX_AGE_MS = 15 * 60_000

/**
 * Runtime state of one watch-along session.
 *
 * This store carries no persisted configuration and imports nothing from the
 * chat pipeline, so the chat context provider can read it without creating
 * an import cycle (chat -> context provider -> session). The engine store
 * owns all writes; everything else reads.
 */
export const useWatchAlongSessionStore = defineStore('watch-along-session', () => {
  const status = ref<WatchAlongStatus>('idle')
  const lastError = ref<string | null>(null)
  /**
   * Name of the source the engine currently watches. Runtime state, not the
   * persisted selection: auto-detected windows never enter the settings.
   */
  const activeSourceName = ref('')
  const observations = ref<WatchAlongObservation[]>([])
  /** Last summary produced by the vision model (summarizer mode `vision` only). */
  const lastSummaryText = ref('')
  const lastCommentAt = ref<number | null>(null)
  /** Total observations since the watch started; the log itself is trimmed. */
  const observationCount = ref(0)
  const commentCount = ref(0)
  const startedAt = ref<number | null>(null)

  const latestObservation = computed(() => observations.value.at(-1) ?? null)

  function pushObservation(observation: WatchAlongObservation) {
    observationCount.value += 1
    observations.value = trimObservations([...observations.value, observation], {
      maxEntries: OBSERVATION_LOG_MAX_ENTRIES,
      maxAgeMs: OBSERVATION_LOG_MAX_AGE_MS,
      now: observation.at,
    })
  }

  /** Observations captured strictly after `at`, oldest first. */
  function observationsAfter(at: number) {
    return observations.value.filter(observation => observation.at > at)
  }

  function resetSession(now = Date.now()) {
    status.value = 'idle'
    lastError.value = null
    activeSourceName.value = ''
    observations.value = []
    lastSummaryText.value = ''
    lastCommentAt.value = null
    observationCount.value = 0
    commentCount.value = 0
    startedAt.value = now
  }

  return {
    status,
    lastError,
    activeSourceName,
    observations,
    lastSummaryText,
    lastCommentAt,
    observationCount,
    commentCount,
    startedAt,

    latestObservation,

    pushObservation,
    observationsAfter,
    resetSession,
  }
})
