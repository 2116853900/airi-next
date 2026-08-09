import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { NowPlayingEngine } from '../../services/airi/now-playing'

import { join, resolve } from 'node:path'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { BrowserWindow as ElectronBrowserWindow, ipcMain, screen } from 'electron'
import { isMacOS } from 'std-env'
import { number, object, optional } from 'valibot'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { createNowPlayingService } from '../../services/airi/now-playing'
import { DANMAKU_DEFAULT_HEIGHT } from '../danmaku'
import { protectPrivilegedWindowNavigation, setupBaseWindowElectronInvokes, transparentWindowConfig } from '../shared/window'

/** Gap between the danmaku bar and the lyrics overlay above it. */
const LYRICS_OVER_BAR_MARGIN = 12

const lyricsWindowSchema = object({
  bounds: optional(object({
    x: number(),
    y: number(),
    width: number(),
    height: number(),
  })),
})

function createLyricsWindow(options?: BrowserWindowConstructorOptions) {
  const window = new ElectronBrowserWindow({
    title: 'Lyrics',
    width: 480,
    height: 150,
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

function centeredAboveDanmakuBar(workArea: Rectangle, width: number, height: number): Rectangle {
  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - DANMAKU_DEFAULT_HEIGHT - LYRICS_OVER_BAR_MARGIN,
    width,
    height,
  }
}

function clampBoundsWithinRect(bounds: Rectangle, rect: Rectangle): Rectangle {
  const x = Math.min(Math.max(bounds.x, rect.x), rect.x + rect.width - bounds.width)
  const y = Math.min(Math.max(bounds.y, rect.y), rect.y + rect.height - bounds.height)
  return { x, y, width: bounds.width, height: bounds.height }
}

/** Restores saved bounds on the display they were last on, else centered above the danmaku bar. */
function resolveInitialBounds(saved?: Rectangle): Rectangle {
  if (saved && saved.width > 0 && saved.height > 0) {
    const matching = screen.getDisplayMatching(saved).workArea
    return clampBoundsWithinRect(saved, matching)
  }
  const workArea = screen.getPrimaryDisplay().workArea
  const width = Math.min(560, Math.floor(workArea.width * 0.8))
  const height = 150
  return centeredAboveDanmakuBar(workArea, width, height)
}

/**
 * Owns the dedicated desktop lyrics overlay window.
 *
 * The window is a transparent, always-on-top panel centered above the danmaku
 * bar. Its renderer reuses the shared now-playing lyrics panel, which
 * subscribes to engine state over eventa; this manager wires the window's
 * eventa context into the engine so state changes reach it. The window is
 * draggable and edge-resizable from the renderer, and its bounds are persisted
 * so a manual layout survives restarts.
 */
export function setupLyricsWindowManager(params: {
  serverChannel: ServerChannel
  i18n: I18n
  nowPlaying: NowPlayingEngine
}) {
  const {
    setup: setupConfig,
    get: getConfig,
    update: updateConfig,
  } = createConfig('windows-lyrics', 'config.json', lyricsWindowSchema, {
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

    const window = createLyricsWindow()
    currentWindow = window
    const { context } = createContext(ipcMain, window)

    await setupBaseWindowElectronInvokes({ context, window, serverChannel: params.serverChannel, i18n: params.i18n })
    createNowPlayingService({ context, engine: params.nowPlaying, window })

    window.setBounds(resolveInitialBounds(getConfig()?.bounds))

    const persistBounds = () => {
      if (window.isDestroyed())
        return
      updateConfig({ bounds: window.getBounds() })
    }
    window.on('resize', persistBounds)
    window.on('move', persistBounds)

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/lyrics'))

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
