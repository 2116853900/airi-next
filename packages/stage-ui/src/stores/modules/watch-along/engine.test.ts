import type { WatchAlongFrame } from './engine'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWatchAlongEngineStore } from './engine'
import { useWatchAlongSessionStore } from './session'
import { useWatchAlongStore } from './store'

const runVisionInference = vi.fn()
const send = vi.fn()
const chatState = { sending: false }
const consciousnessState = { activeProvider: 'mock-provider', activeModel: 'mock-model' }

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../../composables/vision', () => ({
  useVisionInference: () => ({
    runVisionInference,
  }),
}))

vi.mock('../../chat', () => ({
  useChatStore: () => ({
    get sending() {
      return chatState.sending
    },
    send,
  }),
}))

vi.mock('../../chat/session-store', () => ({
  useChatSessionStore: () => ({
    activeSessionId: 'session-1',
  }),
}))

vi.mock('../consciousness', () => ({
  useConsciousnessStore: () => consciousnessState,
}))

const START = 1_000_000_000

function createFrame(luminanceSample: number[], capturedAt: number): WatchAlongFrame {
  return {
    imageDataUrl: `data:image/jpeg;base64,frame-${capturedAt}`,
    luminanceSample,
    capturedAt,
  }
}

describe('watch-along engine', () => {
  let nextFrame: WatchAlongFrame | null = null
  const frameSource = () => nextFrame

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(START)

    runVisionInference.mockReset()
    runVisionInference.mockResolvedValue('An observation.')
    send.mockReset()
    send.mockResolvedValue(undefined)
    chatState.sending = false
    consciousnessState.activeProvider = 'mock-provider'
    consciousnessState.activeModel = 'mock-model'
    nextFrame = null

    const settings = useWatchAlongStore()
    settings.captureIntervalMs = 10_000
    settings.periodicSummaryEnabled = true
    settings.summaryIntervalMs = 300_000
    settings.sceneChangeCommentsEnabled = true
    settings.sceneChangeSensitivity = 'medium'
    settings.commentCooldownMs = 60_000
    settings.summarizerMode = 'vision'
  })

  async function startWatching(sample: number[]) {
    const engine = useWatchAlongEngineStore()
    nextFrame = createFrame(sample, Date.now() + 1)
    engine.start(frameSource, { sourceName: 'Video Player' })
    await vi.advanceTimersByTimeAsync(0)
    return engine
  }

  async function tickWithFrame(engine: ReturnType<typeof useWatchAlongEngineStore>, sample: number[]) {
    nextFrame = createFrame(sample, Date.now())
    await engine.runTick()
  }

  it('observes the first frame and enters the watching state', async () => {
    const session = useWatchAlongSessionStore()
    await startWatching([10, 10, 10, 10])

    expect(session.status).toBe('watching')
    expect(session.activeSourceName).toBe('Video Player')
    expect(session.observationCount).toBe(1)
    expect(runVisionInference).toHaveBeenCalledTimes(1)
    expect(runVisionInference.mock.calls[0]?.[0]).toMatchObject({ workloadId: 'video:watch' })
  })

  it('carries the source name into spoken comments', async () => {
    const engine = await startWatching([0, 0, 0, 0])

    vi.setSystemTime(START + 10_000)
    await tickWithFrame(engine, [255, 255, 255, 255])

    expect(send.mock.calls[0]?.[0]?.text).toContain('"Video Player"')
  })

  it('skips vision inference for a static frame', async () => {
    const session = useWatchAlongSessionStore()
    const engine = await startWatching([100, 100, 100, 100])

    await tickWithFrame(engine, [100, 100, 100, 100])

    expect(runVisionInference).toHaveBeenCalledTimes(1)
    expect(session.observationCount).toBe(1)
  })

  it('sends a scene-change comment when the picture changes a lot', async () => {
    const session = useWatchAlongSessionStore()
    const engine = await startWatching([0, 0, 0, 0])

    vi.setSystemTime(START + 10_000)
    await tickWithFrame(engine, [255, 255, 255, 255])

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'session-1' })
    expect(send.mock.calls[0]?.[0]?.text).toContain('just changed')
    expect(session.commentCount).toBe(1)
    expect(session.lastCommentAt).not.toBeNull()
  })

  it('respects the comment cooldown between reactions', async () => {
    const engine = await startWatching([0, 0, 0, 0])

    vi.setSystemTime(START + 10_000)
    await tickWithFrame(engine, [255, 255, 255, 255])
    expect(send).toHaveBeenCalledTimes(1)

    vi.setSystemTime(START + 20_000)
    await tickWithFrame(engine, [0, 0, 0, 0])

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('summarizes through the vision model in vision summarizer mode', async () => {
    const session = useWatchAlongSessionStore()
    const engine = await startWatching([10, 10, 10, 10])

    vi.setSystemTime(START + 301_000)
    await tickWithFrame(engine, [40, 40, 40, 40])

    // Calls: first observation, second observation, then the summary.
    expect(runVisionInference).toHaveBeenCalledTimes(3)
    expect(runVisionInference.mock.calls[2]?.[0]?.promptOverride).toContain('short factual summary')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]?.text).toContain('An observation.')
    expect(session.lastSummaryText).toBe('An observation.')
  })

  it('hands raw observations to the chat model in consciousness summarizer mode', async () => {
    const settings = useWatchAlongStore()
    settings.summarizerMode = 'consciousness'
    const engine = await startWatching([10, 10, 10, 10])

    vi.setSystemTime(START + 301_000)
    await tickWithFrame(engine, [40, 40, 40, 40])

    // Two observation calls only: no separate summarization call.
    expect(runVisionInference).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]?.text).toContain('Summarize for your user')
    expect(send.mock.calls[0]?.[0]?.text).toContain('An observation.')
  })

  it('defers a due summary while the chat pipeline is busy', async () => {
    const engine = await startWatching([10, 10, 10, 10])

    chatState.sending = true
    vi.setSystemTime(START + 301_000)
    await tickWithFrame(engine, [40, 40, 40, 40])
    expect(send).not.toHaveBeenCalled()

    chatState.sending = false
    vi.setSystemTime(START + 311_000)
    await tickWithFrame(engine, [70, 70, 70, 70])

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stays silent without a configured chat model', async () => {
    consciousnessState.activeProvider = ''
    const engine = await startWatching([10, 10, 10, 10])

    vi.setSystemTime(START + 301_000)
    await tickWithFrame(engine, [40, 40, 40, 40])

    expect(send).not.toHaveBeenCalled()
  })

  it('stops with an error after repeated frame failures', async () => {
    const session = useWatchAlongSessionStore()
    const engine = useWatchAlongEngineStore()

    nextFrame = null
    engine.start(frameSource)
    await vi.advanceTimersByTimeAsync(0)
    await engine.runTick()
    await engine.runTick()

    expect(session.status).toBe('error')
    expect(session.lastError).toContain('Could not capture a frame')
    expect(engine.isRunning).toBe(false)
  })

  it('records vision inference failures and keeps watching', async () => {
    const session = useWatchAlongSessionStore()
    const engine = await startWatching([10, 10, 10, 10])

    runVisionInference.mockRejectedValueOnce(new Error('Vision inference failed'))
    vi.setSystemTime(START + 10_000)
    await tickWithFrame(engine, [40, 40, 40, 40])

    expect(session.lastError).toBe('Vision inference failed')
    expect(session.status).toBe('watching')
    expect(engine.isRunning).toBe(true)
  })

  it('returns to idle on stop', async () => {
    const session = useWatchAlongSessionStore()
    const engine = await startWatching([10, 10, 10, 10])

    engine.stop()

    expect(session.status).toBe('idle')
    expect(engine.isRunning).toBe(false)
  })
})
