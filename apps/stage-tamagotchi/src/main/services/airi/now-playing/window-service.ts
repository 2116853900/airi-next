import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type { NowPlayingEngine } from './engine'

import { defineInvokeHandler } from '@moeru/eventa'
import {
  nowPlayingGetStateInvokeEventa,
  nowPlayingRefreshLyricsInvokeEventa,
  nowPlayingSetEnabledInvokeEventa,
  nowPlayingStateChangedInvokeEventa,
  nowPlayingUpdatePlaybackInvokeEventa,
} from '@proj-airi/stage-shared/now-playing'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Registers now-playing invoke handlers for one Electron window context and
 * forwards engine state changes onto that window.
 *
 * Call stack:
 *
 * createNowPlayingService
 *   -> renderer invoke/eventa handlers
 *     -> {@link NowPlayingEngine}
 */
export function createNowPlayingService(params: {
  context: MainContext
  engine: NowPlayingEngine
  window: BrowserWindow
}) {
  const cleanups: Array<() => void> = [
    params.engine.subscribe((state) => {
      if (!params.window.isDestroyed()) {
        params.context.emit(nowPlayingStateChangedInvokeEventa, state)
      }
    }),
    defineInvokeHandler(params.context, nowPlayingGetStateInvokeEventa, () => params.engine.getState()),
    defineInvokeHandler(params.context, nowPlayingSetEnabledInvokeEventa, enabled => params.engine.setEnabled(enabled)),
    defineInvokeHandler(params.context, nowPlayingRefreshLyricsInvokeEventa, () => params.engine.refreshLyrics()),
    defineInvokeHandler(params.context, nowPlayingUpdatePlaybackInvokeEventa, playback => params.engine.updatePlayback(playback)),
  ]

  const cleanup = () => {
    for (const fn of cleanups)
      fn()
  }

  params.window.on('closed', cleanup)
  return cleanup
}
