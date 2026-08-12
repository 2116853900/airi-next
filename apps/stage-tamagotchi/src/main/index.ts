import type { BrowserWindow } from 'electron'

import type { FileLoggerHandle } from './app/file-logger'

import process, { env, platform } from 'node:process'

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import messages from '@proj-airi/i18n/locales'

import { electronApp, optimizer } from '@electron-toolkit/utils'
import { Format, LogLevel, setGlobalFormat, setGlobalHookPostLog, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { initScreenCaptureForMain } from '@proj-airi/electron-screen-capture/main'
import { app, ipcMain, session } from 'electron'
import { noop } from 'es-toolkit'
import { createLoggLogger, injeca, lifecycle } from 'injeca'
import { isLinux } from 'std-env'

import icon from '../../resources/icon.png?asset'

import { openDebugger, setupDebugger } from './app/debugger'
import { nullFileLoggerHandle, setupFileLogger } from './app/file-logger'
import { installSingleInstanceGuard } from './app/single-instance'
import { createArtistryConfig } from './configs/artistry'
import { createGlobalAppConfig } from './configs/global'
import { emitAppBeforeQuit, emitAppReady, emitAppWindowAllClosed } from './libs/bootkit/lifecycle'
import { setElectronMainDirname } from './libs/electron/location'
import { createI18n } from './libs/i18n'
import { createWindowAuthManagerService } from './services/airi/auth'
import { setupServerChannel } from './services/airi/channel-server'
import { setupGodotStageManager } from './services/airi/godot-stage'
import { setupBuiltInServer } from './services/airi/http-server'
import { setupLiveChatService } from './services/airi/live-chat'
import { setupMcpStdioManager } from './services/airi/mcp-servers'
import { setupMusicDlManager } from './services/airi/music-dl'
import { createMprisProvider, setupNowPlayingEngine } from './services/airi/now-playing'
import { setupExtensionHost } from './services/airi/plugins'
import { setupUniBarrageManager } from './services/airi/unibarrage'
import { setupArtistryBridge } from './services/airi/widgets/artistry-bridge'
import { setupAutoUpdater } from './services/electron/auto-updater'
import { setupGlobalShortcutService } from './services/electron/global-shortcut'
import { setupMediaPermissionHandlers } from './services/electron/media-permissions'
import { setupTray } from './tray'
import { setupAboutWindowReusable } from './windows/about'
import { setupBeatSync } from './windows/beat-sync'
import { setupCaptionWindowManager } from './windows/caption'
import { setupChatWindowReusableFunc } from './windows/chat'
import { setupDanmakuWindowManager } from './windows/danmaku'
import { isDesktopOverlayEnabled, setupDesktopOverlayWindow } from './windows/desktop-overlay'
import { setupDevtoolsWindow } from './windows/devtools'
import { setupEditorWindowManager } from './windows/editor'
import { setupLyricsWindowManager } from './windows/lyrics'
import { setupMainWindow } from './windows/main'
import { setupNoticeWindowManager } from './windows/notice'
import { setupOnboardingWindowManager } from './windows/onboarding'
import { setupSettingsWindowReusableFunc } from './windows/settings'
import { setupSpotlightWindowManager } from './windows/spotlight'
import { setupWidgetsWindowManager } from './windows/widgets'

// TODO: once we refactored eventa to support window-namespaced contexts,
// we can remove the setMaxListeners call below since eventa will be able to dispatch and
// manage events within eventa's context system.
ipcMain.setMaxListeners(100)

setElectronMainDirname(dirname(fileURLToPath(import.meta.url)))
setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)
setupDebugger()

const log = useLogg('main').useGlobalConfig()

const appUserDataPath = env.APP_USER_DATA_PATH?.trim()
if (appUserDataPath) {
  app.setPath('userData', appUserDataPath)
}

// Thanks to [@blurymind](https://github.com/blurymind),
//
// When running Electron on Linux, navigator.gpu.requestAdapter() fails.
// In order to enable WebGPU and process the shaders fast enough, we need the following
// command line switches to be set.
//
// https://github.com/electron/electron/issues/41763#issuecomment-2051725363
// https://github.com/electron/electron/issues/41763#issuecomment-3143338995
if (isLinux) {
  app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')
  app.commandLine.appendSwitch('enable-unsafe-webgpu')
  app.commandLine.appendSwitch('enable-features', 'Vulkan')

  // NOTICE: we need UseOzonePlatform, WaylandWindowDecorations for working on Wayland.
  // Partially related to https://github.com/electron/electron/issues/41551, since X11 is deprecating now,
  // we can safely remove the feature flags for Electron once they made it default supported.
  // Fixes: https://github.com/moeru-ai/airi/issues/757
  // Ref: https://github.com/mmaura/poe2linuxcompanion/blob/90664607a147ea5ccea28df6139bd95fb0ebab0e/electron/main/index.ts#L28-L46
  if (env.XDG_SESSION_TYPE === 'wayland') {
    app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')

    app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform')
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
  }
}

app.dock?.setIcon(icon)
electronApp.setAppUserModelId('ai.moeru.airi')

// Track the real user-facing AIRI window because the process also owns hidden utility windows.
// The second-instance handler should restore the main UI instead of accidentally surfacing internals.
let userFacingMainWindow: BrowserWindow | undefined
const shouldStartMainProcess = installSingleInstanceGuard({ app, getWindow: () => userFacingMainWindow })

if (shouldStartMainProcess) {
  initScreenCaptureForMain()
}

let fileLogger: FileLoggerHandle = nullFileLoggerHandle
let skipFileLogging = false

app.whenReady().then(async () => {
  if (!shouldStartMainProcess) {
    return
  }

  setupMediaPermissionHandlers(session.defaultSession)

  // Initialize file logger and register the hook
  fileLogger = await setupFileLogger()

  // Register the global hook for file logging
  setGlobalHookPostLog((_, formatted) => {
    if (skipFileLogging || fileLogger.logFileFd === null)
      return
    void fileLogger.appendLog(formatted)
  })

  injeca.setLogger(createLoggLogger(useLogg('injeca').useGlobalConfig()))

  const appConfig = injeca.provide('configs:app', () => createGlobalAppConfig())
  const artistryConfig = injeca.provide('configs:artistry', () => createArtistryConfig())
  const electronApp = injeca.provide('host:electron:app', () => app)
  const autoUpdater = injeca.provide('services:auto-updater', {
    dependsOn: { appConfig },
    build: ({ dependsOn }) => setupAutoUpdater({
      enabled: import.meta.env.VITE_DISTRIBUTION !== 'steam',
      getStoredUpdateLane: () => dependsOn.appConfig.get()?.updateChannel,
      setStoredUpdateLane: (lane) => {
        const currentConfig = dependsOn.appConfig.get()
        dependsOn.appConfig.update({
          language: currentConfig?.language ?? 'en',
          updateChannel: lane,
        })
      },
    }),
  })

  const i18n = injeca.provide('libs:i18n', {
    dependsOn: { appConfig },
    build: ({ dependsOn }) => createI18n({ messages, locale: dependsOn.appConfig.get()?.language }),
  })

  const serverChannel = injeca.provide('modules:channel-server', {
    dependsOn: { app: electronApp, lifecycle },
    build: async ({ dependsOn }) => setupServerChannel(dependsOn),
  })

  const airiHttpServer = injeca.provide('modules:airi-http-server', {
    build: async () => setupBuiltInServer({ servers: [] }),
  })

  const godotStageManager = injeca.provide('modules:godot-stage-manager', {
    build: async () => setupGodotStageManager(),
  })

  const mcpStdioManager = injeca.provide('modules:mcp-stdio-manager', {
    build: async () => setupMcpStdioManager(),
  })

  const widgetsManager = injeca.provide('windows:widgets', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupWidgetsWindowManager(dependsOn),
  })

  const pluginHost = injeca.provide('modules:plugin-host', {
    dependsOn: { serverChannel, widgetsManager },
    build: ({ dependsOn }) => setupExtensionHost(dependsOn),
  })

  const windowAuthManager = injeca.provide('services:window-auth-manager', () => createWindowAuthManagerService())

  const globalShortcut = injeca.provide('services:global-shortcut', () => setupGlobalShortcutService())

  // BeatSync will create a background window to capture and process audio.
  const beatSync = injeca.provide('windows:beat-sync', () => setupBeatSync())

  // Now-playing lyrics: MPRIS is Linux-only, so other platforms keep a no-op
  // provider while the renderer plumbing stays identical.
  const nowPlaying = injeca.provide('modules:now-playing', {
    build: () => setupNowPlayingEngine({ provider: isLinux ? createMprisProvider() : null }),
  })

  const musicDl = injeca.provide('modules:music-dl', {
    build: () => setupMusicDlManager(),
  })

  // Bundled UniBarrage danmaku proxy sidecar; the live-chat connector dials it.
  const unibarrage = injeca.provide('modules:unibarrage', {
    build: () => setupUniBarrageManager(),
  })

  // In-app live-room connector (Bilibili + Douyin via the managed UniBarrage).
  const liveChat = injeca.provide('modules:live-chat', {
    dependsOn: { unibarrage },
    build: ({ dependsOn }) => setupLiveChatService({ getBridge: () => dependsOn.unibarrage.getBridge() }),
  })

  const devtoolsMarkdownStressWindow = injeca.provide('windows:devtools:markdown-stress', () => setupDevtoolsWindow())

  const onboardingWindowManager = injeca.provide('windows:onboarding', {
    dependsOn: { serverChannel, i18n, windowAuthManager },
    build: ({ dependsOn }) => setupOnboardingWindowManager(dependsOn),
  })

  const noticeWindow = injeca.provide('windows:notice', {
    dependsOn: { i18n, serverChannel },
    build: ({ dependsOn }) => setupNoticeWindowManager(dependsOn),
  })

  const aboutWindow = injeca.provide('windows:about', {
    dependsOn: { autoUpdater, i18n, serverChannel },
    build: ({ dependsOn }) => setupAboutWindowReusable(dependsOn),
  })

  const chatWindow = injeca.provide('windows:chat', {
    dependsOn: { widgetsManager, serverChannel, mcpStdioManager, i18n },
    build: ({ dependsOn }) => setupChatWindowReusableFunc(dependsOn),
  })

  const spotlightWindow = injeca.provide('windows:spotlight', {
    dependsOn: { serverChannel, i18n, chatWindow, globalShortcut, appConfig },
    build: ({ dependsOn }) => setupSpotlightWindowManager(dependsOn),
  })

  const editorWindow = injeca.provide('windows:editor', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupEditorWindowManager(dependsOn),
  })

  const settingsWindow = injeca.provide('windows:settings', {
    dependsOn: { widgetsManager, beatSync, autoUpdater, devtoolsWindow: devtoolsMarkdownStressWindow, serverChannel, godotStageManager, mcpStdioManager, musicDlManager: musicDl, i18n, windowAuthManager, globalShortcut, spotlightWindow, nowPlaying, liveChat, unibarrageManager: unibarrage },
    build: async ({ dependsOn }) =>
      setupSettingsWindowReusableFunc({
        ...dependsOn,
        getMainWindow: () => userFacingMainWindow,
      }),
  })

  const mainWindow = injeca.provide('windows:main', {
    dependsOn: { editorWindow, settingsWindow, chatWindow, widgetsManager, noticeWindow, beatSync, autoUpdater, serverChannel, godotStageManager, mcpStdioManager, musicDlManager: musicDl, i18n, onboardingWindowManager, windowAuthManager, nowPlaying, liveChat, unibarrageManager: unibarrage },
    build: async ({ dependsOn }) => setupMainWindow({
      ...dependsOn,
      onWindowCreated: (window) => {
        userFacingMainWindow = window
      },
    }),
  })

  const captionWindow = injeca.provide('windows:caption', {
    dependsOn: { mainWindow, serverChannel, i18n, nowPlaying },
    build: async ({ dependsOn }) => setupCaptionWindowManager(dependsOn),
  })

  const danmakuWindow = injeca.provide('windows:danmaku', {
    dependsOn: { serverChannel, i18n },
    build: ({ dependsOn }) => setupDanmakuWindowManager(dependsOn),
  })

  const lyricsWindow = injeca.provide('windows:lyrics', {
    dependsOn: { serverChannel, i18n, nowPlaying },
    build: ({ dependsOn }) => setupLyricsWindowManager(dependsOn),
  })

  const tray = injeca.provide('app:tray', {
    dependsOn: { mainWindow, settingsWindow, captionWindow, danmakuWindow, lyricsWindow, widgetsWindow: widgetsManager, serverChannel, beatSyncBgWindow: beatSync, aboutWindow, i18n },
    build: async ({ dependsOn }) => setupTray(dependsOn),
  })

  // Desktop grounding overlay — gated by AIRI_DESKTOP_OVERLAY=1
  if (isDesktopOverlayEnabled()) {
    const desktopOverlay = injeca.provide('windows:desktop-overlay', {
      dependsOn: { mcpStdioManager, serverChannel, i18n },
      build: async ({ dependsOn }) => setupDesktopOverlayWindow(dependsOn),
    })

    // NOTICE: Separate invoke ensures the overlay is eagerly built.
    // Without this, injeca.start() would skip it because no other
    // provider depends on 'windows:desktop-overlay'.
    injeca.invoke({
      dependsOn: { desktopOverlay },
      callback: noop,
    })
  }

  injeca.invoke({
    dependsOn: { mainWindow, tray, serverChannel, airiHttpServer, godotStageManager, pluginHost, mcpStdioManager, onboardingWindow: onboardingWindowManager, widgetsWindow: widgetsManager, spotlightWindow, artistryConfig },
    callback: async (deps) => {
      const { context } = createContext(ipcMain)
      await setupArtistryBridge({
        widgetsManager: deps.widgetsWindow,
        context,
        artistryConfig: deps.artistryConfig,
      })
    },
  })

  // NOTICE: Separate invoke ensures the now-playing engine is eagerly started.
  // The engine only gets built as a window dependency, and building does not
  // begin watching MPRIS — that requires an explicit start.
  injeca.invoke({
    dependsOn: { nowPlaying },
    callback: ({ nowPlaying: engine }) => {
      engine.start()
    },
  })

  injeca.invoke({
    dependsOn: { musicDl },
    callback: async ({ musicDl: manager }) => {
      try {
        await manager.start()
      }
      catch (error) {
        log.withError(error).warn('failed to start song request sidecar')
      }
    },
  })

  // NOTICE: Separate invoke ensures the bundled UniBarrage sidecar is spawned
  // and ready before the live-chat connector starts dialing rooms. injeca awaits
  // invoke callbacks in registration order, so this waits only for the bridge
  // API to answer (bounded by the manager's readiness timeout).
  injeca.invoke({
    dependsOn: { unibarrage },
    callback: async ({ unibarrage: manager }) => {
      try {
        await manager.start()
      }
      catch (error) {
        log.withError(error).error('failed to start UniBarrage sidecar')
      }
    },
  })

  // Same for live-chat: the connector only dials rooms after start().
  injeca.invoke({
    dependsOn: { liveChat },
    callback: ({ liveChat: service }) => {
      service.start()
    },
  })

  injeca.start().catch(err => console.error(err))

  // Lifecycle
  emitAppReady()

  // Extra
  openDebugger()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
}).catch((err) => {
  log.withError(err).error('Error during app initialization')
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  emitAppWindowAllClosed()

  if (platform !== 'darwin') {
    app.quit()
  }
})

let appExiting = false

// Clean up server and intervals when app quits
async function handleAppExit() {
  if (appExiting)
    return

  appExiting = true

  let exitedNormally = true

  /**
   * Safely execute fn and log any errors that occur, marking the exit as abnormal
   * if an error is caught.
   *
   * @param operation - A verb phrase describing the operation.
   * @param fn - Any function to execute. It can be either sync or async.
   * @returns A promise that resolves when the operation is complete.
   */
  async function logIfError(operation: string, fn: () => unknown): Promise<void> {
    try {
      await fn()
    }
    catch (error) {
      exitedNormally = false
      log.withError(error).error(`[app-exit] Failed to ${operation}:`)
    }
  }

  await Promise.all([
    logIfError('execute onAppBeforeQuit hooks', () => emitAppBeforeQuit()),
    logIfError('stop injeca', () => injeca.stop()),
  ])

  // Prevent the global log hook from trying to write to the file after close() is called,
  // which would cause a recursive failure if close() itself throws.
  skipFileLogging = true
  await logIfError('flush file logs', () => fileLogger.close()) // Ensure all logs are flushed

  if (!exitedNormally) {
    app.exit(1)
  }
  else {
    app.quit()
  }
}

process.on('SIGINT', () => handleAppExit())

app.on('before-quit', (event) => {
  if (appExiting)
    return

  event.preventDefault()
  handleAppExit()
})
