import type { createContext, ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type { UniBarrageManager } from '../unibarrage'
import type { LiveChatService } from './service'

import { defineInvokeHandler } from '@moeru/eventa'
import {
  liveChatAddRoomInvokeEventa,
  liveChatGetStatusInvokeEventa,
  liveChatListRoomsInvokeEventa,
  liveChatRemoveRoomInvokeEventa,
  liveChatSetEnabledInvokeEventa,
  liveChatStatusChangedInvokeEventa,
  liveChatUpdateRoomInvokeEventa,
  unibarrageGetStatusInvokeEventa,
  unibarrageStatusChangedInvokeEventa,
} from '@proj-airi/stage-shared/live-chat'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Binds an invoke handler to its owning window.
 *
 * Eventa's electron adapter registers one `ipcMain` listener per created
 * context and delivers every renderer invoke to all of them (there is no
 * inbound sender filtering; `onlySameWindow` only affects replies). Because
 * the live-chat handlers are registered for both the settings and the main
 * window, an unmasked handler would execute once per registered context —
 * turning non-idempotent operations like `addRoom` into duplicates.
 */
function fromThisWindow<P, R>(
  window: BrowserWindow,
  handler: (payload: P, options?: { abortController?: AbortController } & ElectronMainEmitOptions) => R,
) {
  return (payload: P, options?: { abortController?: AbortController } & ElectronMainEmitOptions): R => {
    const senderId = options?.raw?.ipcMainEvent?.sender?.id
    if (senderId != null && senderId !== window.webContents.id)
      return undefined as R
    return handler(payload, options)
  }
}

/**
 * Registers live-chat invoke handlers for one Electron window context and
 * forwards room/UniBarrage status changes onto that window.
 *
 * Call stack:
 *
 * createLiveChatService
 *   -> renderer invoke/eventa handlers
 *     -> {@link LiveChatService} / {@link UniBarrageManager}
 */
export function createLiveChatService(params: {
  context: MainContext
  service: LiveChatService
  window: BrowserWindow
  unibarrageManager: UniBarrageManager
}) {
  const cleanups: Array<() => void> = [
    params.service.subscribeStatus((status) => {
      if (!params.window.isDestroyed()) {
        params.context.emit(liveChatStatusChangedInvokeEventa, status)
      }
    }),
    params.unibarrageManager.onStatusChange((status) => {
      if (!params.window.isDestroyed()) {
        params.context.emit(unibarrageStatusChangedInvokeEventa, status)
      }
    }),
    defineInvokeHandler(params.context, liveChatListRoomsInvokeEventa, fromThisWindow(params.window, () => params.service.listRooms())),
    defineInvokeHandler(params.context, liveChatAddRoomInvokeEventa, fromThisWindow(params.window, input => params.service.addRoom(input))),
    defineInvokeHandler(params.context, liveChatRemoveRoomInvokeEventa, fromThisWindow(params.window, id => params.service.removeRoom(id))),
    defineInvokeHandler(params.context, liveChatUpdateRoomInvokeEventa, fromThisWindow(params.window, payload => params.service.updateRoom(payload.id, payload.patch))),
    defineInvokeHandler(params.context, liveChatSetEnabledInvokeEventa, fromThisWindow(params.window, payload => params.service.setEnabled(payload.id, payload.enabled))),
    defineInvokeHandler(params.context, liveChatGetStatusInvokeEventa, fromThisWindow(params.window, () => params.service.getStatus())),
    defineInvokeHandler(params.context, unibarrageGetStatusInvokeEventa, fromThisWindow(params.window, () => params.unibarrageManager.getStatus())),
  ]

  const cleanup = () => {
    for (const fn of cleanups)
      fn()
  }

  params.window.on('closed', cleanup)
  return cleanup
}
