import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { MusicDlManager } from '.'

import { defineInvokeHandler } from '@moeru/eventa'
import {
  songRequestLoginClearInvokeEventa,
  songRequestLoginQrCheckInvokeEventa,
  songRequestLoginQrCreateInvokeEventa,
  songRequestLoginStateInvokeEventa,
  songRequestResolveInvokeEventa,
} from '@proj-airi/stage-shared/song-request'

type MainContext = ReturnType<typeof createContext>['context']

/** Registers song request RPC (resolve + source account login) for one window. */
export function createMusicDlService(params: { context: MainContext, manager: MusicDlManager }) {
  const cleanups = [
    defineInvokeHandler(params.context, songRequestResolveInvokeEventa, input => params.manager.resolve(input)),
    defineInvokeHandler(params.context, songRequestLoginQrCreateInvokeEventa, input => params.manager.loginQrCreate(input.source)),
    defineInvokeHandler(params.context, songRequestLoginQrCheckInvokeEventa, input => params.manager.loginQrCheck(input.source, input.key)),
    defineInvokeHandler(params.context, songRequestLoginStateInvokeEventa, () => params.manager.loginState()),
    defineInvokeHandler(params.context, songRequestLoginClearInvokeEventa, input => params.manager.loginClear(input.source)),
  ]

  return () => {
    for (const cleanup of cleanups)
      cleanup()
  }
}
