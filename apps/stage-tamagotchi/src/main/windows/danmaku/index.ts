import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { join, resolve } from 'node:path'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { BrowserWindow as ElectronBrowserWindow, ipcMain, screen } from 'electron'
import { isMacOS } from 'std-env'
import { number, object, optional } from 'valibot'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { protectPrivilegedWindowNavigation, setupBaseWindowElectronInvokes, transparentWindowConfig } from '../shared/window'

/** Default height of the vertical danmaku overlay. */
export const DANMAKU_DEFAULT_HEIGHT = 300

const danmakuWindowSchema = object({
  bounds: optional(object({
    x: number(),
    y: number(),
    width: number(),
    height: number(),
  })),
})

function createDanmakuWindow(options?: BrowserWindowConstructorOptions) {
  const window = new ElectronBrowserWindow({
    title: 'Danmaku',
    width: 480,
    height: DANMAKU_DEFAULT_HEIGHT,
    show: false,
    icon,
    webPreferences: {
      preload: join(getElectronMainDirname(), '../preload/index.mjs'),
      sandbox: false,
    },
    // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
    //
    // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
    // https://stackoverflow.com/questions/39838282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
    type: 'panel',
    ...transparentWindowConfig(),
    ...options,
  })

  window.setAlwaysOnTop(true, 'screen-saver', 2)
  window.setFullScreenable(false)
  window.setVisibleOnAllWorkspaces(true)
  if (isMacOS) {
    window.setWindowButtonVisibility(false)
  }

  window.on('ready-to-show', () => window.show())
  protectPrivilegedWindowNavigation(window)

  return window
}

function bottomBarBounds(workArea: Rectangle, height: number): Rectangle {
  return {
    x: workArea.x,
    y: workArea.y + workArea.height - height,
    width: workArea.width,
    height,
  }
}

function clampBoundsWithinRect(bounds: Rectangle, rect: Rectangle): Rectangle {
  const x = Math.min(Math.max(bounds.x, rect.x), rect.x + rect.width - bounds.width)
  const y = Math.min(Math.max(bounds.y, rect.y), rect.y + rect.height - bounds.height)
  return { x, y, width: bounds.width, height: bounds.height }
}

/** Restores saved bounds on the display they were last on, falling back to the bottom bar. */
function resolveInitialBounds(saved?: Rectangle): Rectangle {
  const workArea = screen.getPrimaryDisplay().workArea
  if (saved && saved.width > 0 && saved.height > 0) {
    const matching = screen.getDisplayMatching(saved).workArea
    const clamped = clampBoundsWithinRect(saved, matching)
    // Clamping collapses over-large saved sizes; keep them but let the user
    // resize again if the display changed.
    if (clamped.width > 0 && clamped.height > 0)
      return clamped
  }
  return bottomBarBounds(workArea, DANMAKU_DEFAULT_HEIGHT)
}

/**
 * Owns the dedicated desktop danmaku overlay window.
 *
 * The window is a transparent, always-on-top bar anchored to the bottom of the
 * primary display. Its renderer registers as the server-channel consumer for
 * `input:live-chat` (see App.vue) and renders scrolling danmaku. The whole
 * window is draggable and edge-resizable from the renderer, and its bounds are
 * persisted so a manual layout survives restarts.
 */
export function setupDanmakuWindowManager(params: {
  serverChannel: ServerChannel
  i18n: I18n
}) {
  const {
    setup: setupConfig,
    get: getConfig,
    update: updateConfig,
  } = createConfig('windows-danmaku', 'config.json', danmakuWindowSchema, {
    default: {},
    autoHeal: true,
  })
  setupConfig()

  let currentWindow: BrowserWindow | undefined
  const visibilityListeners = new Set<() => void>()

  const emitVisibilityChanged = () => {
    for (const listener of visibilityListeners) {
      try {
        listener()
      }
      catch {
        // ignore listener failures
      }
    }
  }

  const reusable = createReusableWindow(async () => {
    // TODO: once we refactored eventa to support window-namespaced contexts,
    // we can remove the setMaxListeners call below since eventa will be able to dispatch and
    // manage events within eventa's context system.
    ipcMain.setMaxListeners(0)

    const window = createDanmakuWindow()
    currentWindow = window
    const { context } = createContext(ipcMain, window)

    await setupBaseWindowElectronInvokes({ context, window, serverChannel: params.serverChannel, i18n: params.i18n })

    window.setBounds(resolveInitialBounds(getConfig()?.bounds))

    const persistBounds = () => {
      if (window.isDestroyed())
        return
      updateConfig({ bounds: window.getBounds() })
    }
    window.on('resize', persistBounds)
    window.on('move', persistBounds)

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/danmaku'))

    window.on('show', emitVisibilityChanged)
    window.on('hide', emitVisibilityChanged)
    window.on('closed', () => {
      if (currentWindow === window) {
        currentWindow = undefined
      }
      emitVisibilityChanged()
    })

    return window
  })

  function isVisible(): boolean {
    return Boolean(currentWindow && !currentWindow.isDestroyed() && currentWindow.isVisible())
  }

  async function toggleVisibility() {
    if (isVisible()) {
      currentWindow?.hide()
      return
    }

    const window = await reusable.getWindow()
    if (window.isMinimized()) {
      window.restore()
    }
    // showInactive keeps the always-on-top overlay from stealing keyboard focus.
    window.showInactive()
  }

  function onVisibilityChanged(listener: () => void): () => void {
    visibilityListeners.add(listener)
    return () => {
      visibilityListeners.delete(listener)
    }
  }

  return {
    getWindow: () => reusable.getWindow(),
    isVisible,
    toggleVisibility,
    onVisibilityChanged,
  }
}
