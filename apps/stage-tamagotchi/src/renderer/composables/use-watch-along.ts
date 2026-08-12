import type { WatchAlongFrame, WatchTargetCandidate } from '@proj-airi/stage-ui/stores/modules/watch-along'

import { useElectronScreenCapture } from '@proj-airi/electron-screen-capture/vue'
import {
  matchWatchTarget,
  parseWatchTargetKeywords,
  useWatchAlongEngineStore,
  useWatchAlongStore,
} from '@proj-airi/stage-ui/stores/modules/watch-along'
import { tryOnScopeDispose } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useVisionScreenCapture } from './use-vision-screen-capture'

/**
 * Grayscale sample grid for frame-difference checks. 32x18 keeps the 16:9
 * shape, is cheap to read back every tick, and still separates a paused
 * frame from normal playback or a scene cut.
 */
const LUMINANCE_SAMPLE_WIDTH = 32
const LUMINANCE_SAMPLE_HEIGHT = 18

/**
 * How often auto-start scans window titles for a matching video window.
 * The scan requests no thumbnails and no icons, so it stays cheap.
 */
const AUTO_DETECT_INTERVAL_MS = 15_000

/**
 * Wires the watch-along engine to Electron screen capture. The main window
 * owns this: it is the chat authority and hosts the speech pipeline, and it
 * stays alive for the whole app session so the capture stream survives
 * settings-window navigation.
 *
 * Two ways start a watch session, manual selection first:
 * - Manual: the settings page writes `enabled` and `sourceId`; localStorage
 *   storage events carry those changes across windows.
 * - Auto-start: while `autoStartEnabled` is on, a title scan looks for a
 *   window that matches `autoStartKeywords` (video site in a browser, or a
 *   desktop client) and watches it until the window disappears.
 */
export function useWatchAlong() {
  const settings = useWatchAlongStore()
  const engine = useWatchAlongEngineStore()
  const { enabled, sourceId, sourceName, autoStartEnabled, autoStartKeywords } = storeToRefs(settings)

  const {
    activeSourceId,
    activeStream,
    startStream,
    stopStream,
    cleanup,
    captureFrame,
  } = useVisionScreenCapture({ types: ['screen', 'window'] })

  // A detached video element renders MediaStream frames in Chromium without
  // touching the main window template.
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true

  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = LUMINANCE_SAMPLE_WIDTH
  sampleCanvas.height = LUMINANCE_SAMPLE_HEIGHT
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })

  function sampleLuminance(): number[] | null {
    if (!sampleContext)
      return null
    if (video.readyState < 2 || video.videoWidth <= 0)
      return null

    sampleContext.drawImage(video, 0, 0, LUMINANCE_SAMPLE_WIDTH, LUMINANCE_SAMPLE_HEIGHT)
    const { data } = sampleContext.getImageData(0, 0, LUMINANCE_SAMPLE_WIDTH, LUMINANCE_SAMPLE_HEIGHT)

    const luminance: number[] = []
    for (let index = 0; index < data.length; index += 4) {
      // Rec. 709 luma weights: grayscale that tracks perceived brightness.
      luminance.push(Math.round(
        0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2],
      ))
    }
    return luminance
  }

  function hasLiveStream() {
    return activeStream.value?.getVideoTracks().some(track => track.readyState === 'live') ?? false
  }

  async function ensureStream() {
    if (hasLiveStream())
      return

    const stream = await startStream()
    video.srcObject = stream
    await video.play()

    if (video.readyState >= 2)
      return
    await new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true })
    })
  }

  /**
   * Frame supplier for the engine. Returns `null` on any capture problem;
   * the engine counts consecutive failures and stops with an error state
   * when the source is gone for good.
   */
  async function acquireFrame(): Promise<WatchAlongFrame | null> {
    try {
      await ensureStream()

      const imageDataUrl = captureFrame(video, 0.82, 1280, 720)
      const luminanceSample = sampleLuminance()
      if (!imageDataUrl || !luminanceSample)
        return null

      return { imageDataUrl, luminanceSample, capturedAt: Date.now() }
    }
    catch (error) {
      console.warn('[watch-along] frame capture failed:', error)
      return null
    }
  }

  function stopCapture() {
    engine.stop()
    stopStream()
    video.pause()
    video.srcObject = null
  }

  // --- Auto-start window detection ---

  const { getSources: getDetectionSources } = useElectronScreenCapture(window.electron.ipcRenderer, {
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  })

  const detectedTarget = ref<WatchTargetCandidate | null>(null)
  let detectTimer: ReturnType<typeof setInterval> | null = null
  let isDetecting = false

  async function detectWatchTarget() {
    if (isDetecting)
      return

    isDetecting = true
    try {
      const keywords = parseWatchTargetKeywords(autoStartKeywords.value)
      if (keywords.length === 0) {
        detectedTarget.value = null
        return
      }

      const windows = await getDetectionSources()
      const next = matchWatchTarget(
        windows.map(({ id, name }) => ({ id, name })),
        keywords,
        detectedTarget.value?.id ?? null,
      )

      // Browser titles change with every video while the window id stays
      // stable; only replace the target when the id changes so the watcher
      // below does not restart the engine on every title update.
      if ((next?.id ?? null) !== (detectedTarget.value?.id ?? null))
        detectedTarget.value = next
    }
    catch (error) {
      console.warn('[watch-along] window detection failed:', error)
    }
    finally {
      isDetecting = false
    }
  }

  function stopDetection() {
    if (detectTimer)
      clearInterval(detectTimer)
    detectTimer = null
    detectedTarget.value = null
  }

  watch(autoStartEnabled, (next) => {
    if (!next) {
      stopDetection()
      return
    }
    if (detectTimer)
      return

    void detectWatchTarget()
    detectTimer = setInterval(() => {
      void detectWatchTarget()
    }, AUTO_DETECT_INTERVAL_MS)
  }, { immediate: true })

  // --- Target arbitration: manual selection wins over auto-detection ---

  const activeTarget = computed<WatchTargetCandidate | null>(() => {
    if (enabled.value && sourceId.value)
      return { id: sourceId.value, name: sourceName.value }
    if (autoStartEnabled.value)
      return detectedTarget.value
    return null
  })

  watch(activeTarget, (next, previous) => {
    if (!next) {
      stopCapture()
      return
    }
    if (previous && previous.id === next.id)
      return

    activeSourceId.value = next.id
    // Drop any stream from a previous source before the engine's first tick
    // reopens capture lazily through `ensureStream`.
    stopStream()
    engine.start(acquireFrame, { sourceName: next.name })
  }, { immediate: true })

  tryOnScopeDispose(() => {
    stopDetection()
    stopCapture()
    cleanup()
  })
}
