import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

import type {
  SongRequestLoginState,
  SongRequestQrLoginCheckResult,
  SongRequestQrLoginSession,
  SongRequestResolveInput,
  SongRequestTrack,
} from '@proj-airi/stage-shared/song-request'
import type { BaseIssue, BaseSchema, InferOutput } from 'valibot'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { useLogg } from '@guiiai/logg'
import { errorMessageFrom } from '@moeru/std'
import { app } from 'electron'
import { getRandomPort } from 'get-port-please'
import { boolean, number, object, optional, parse, picklist, record, string } from 'valibot'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'
import { getElectronMainDirname } from '../../../libs/electron/location'
import { buildSpawnArgs, devBinaryPath, packagedBinaryPath } from './paths'

const READY_TIMEOUT_MS = 20_000
const READY_POLL_MS = 500
const RESOLVE_TIMEOUT_MS = 45_000
// Login endpoints only relay one platform API call each.
const LOGIN_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 2_000

const trackSchema = object({
  id: string(),
  title: string(),
  artist: string(),
  album: optional(string()),
  durationMs: optional(number()),
  source: string(),
  coverUrl: optional(string()),
  streamUrl: string(),
})

const qrLoginSessionSchema = object({
  source: string(),
  key: string(),
  url: optional(string()),
  imageUrl: optional(string()),
  expiresAt: optional(number()),
})

const qrLoginCheckSchema = object({
  status: picklist(['waiting', 'scanned', 'success', 'expired', 'failed']),
  message: optional(string()),
  cookieSaved: optional(boolean()),
})

const loginStateSchema = object({
  sources: record(string(), boolean()),
})

const errorSchema = object({ error: string() })

interface MusicDlBridge {
  baseUrl: string
  token: string
}

export interface MusicDlManager {
  start: () => Promise<void>
  stop: () => Promise<void>
  resolve: (input: SongRequestResolveInput) => Promise<SongRequestTrack>
  loginQrCreate: (source: string) => Promise<SongRequestQrLoginSession>
  loginQrCheck: (source: string, key: string) => Promise<SongRequestQrLoginCheckResult>
  loginState: () => Promise<SongRequestLoginState>
  loginClear: (source: string) => Promise<SongRequestLoginState>
}

export { binaryNameForPlatform, buildSpawnArgs, devBinaryPath, engineOsForPlatform, packagedBinaryPath } from './paths'

/**
 * Owns the authenticated go-music-dl sidecar and its loopback HTTP bridge.
 *
 * State model:
 *
 * - `start()` creates one child process and waits for its authenticated health endpoint.
 * - `bridge` exists only while that child process is expected to answer requests.
 * - `stop()`, process exit, and process errors clear the bridge before another request can use it.
 */
export function setupMusicDlManager(): MusicDlManager {
  const log = useLogg('main/music-dl').useGlobalConfig()
  let child: ChildProcess | undefined
  let bridge: MusicDlBridge | undefined
  let startPromise: Promise<void> | undefined

  function pipeLog(stream: Readable | null, level: 'debug' | 'warn') {
    if (!stream)
      return
    stream.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf-8').trim()
      if (!message)
        return
      if (level === 'warn')
        log.warn(message)
      else
        log.debug(message)
    })
  }

  async function resolveBinary(): Promise<string> {
    if (app.isPackaged) {
      const path = packagedBinaryPath(process.platform, process.resourcesPath)
      await access(path)
      return path
    }

    const environmentPath = process.env.MUSIC_DL_BIN?.trim()
    if (environmentPath) {
      await access(environmentPath)
      return environmentPath
    }

    const path = await devBinaryPath(process.platform, getElectronMainDirname())
    if (path)
      return path

    throw new Error(
      'The song request sidecar is missing. '
      + 'Run: pnpm -F @proj-airi/stage-tamagotchi-music-dl build',
    )
  }

  async function waitForReady(nextBridge: MusicDlBridge): Promise<boolean> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${nextBridge.baseUrl}/v1/health`, {
          headers: { Authorization: `Bearer ${nextBridge.token}` },
        })
        if (response.ok)
          return true
      }
      catch {
        // The process can accept connections after its Go runtime is ready.
      }
      await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
    }
    return false
  }

  async function startProcess() {
    const binary = await resolveBinary()
    const port = await getRandomPort('127.0.0.1')
    const token = randomUUID()
    const nextBridge = { baseUrl: `http://127.0.0.1:${port}`, token }
    const workingDirectory = join(app.getPath('userData'), 'music-dl')
    await mkdir(workingDirectory, { recursive: true })

    log.withFields({ port }).debug('spawning song request sidecar')
    const handle = spawn(binary, buildSpawnArgs({ port, token }), {
      cwd: workingDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = handle
    bridge = nextBridge
    pipeLog(handle.stdout, 'debug')
    pipeLog(handle.stderr, 'warn')

    handle.on('error', (error) => {
      if (child === handle) {
        child = undefined
        bridge = undefined
      }
      log.withError(error).error('song request sidecar process error')
    })
    handle.on('exit', (code, signal) => {
      if (child === handle) {
        child = undefined
        bridge = undefined
      }
      log.withFields({ code, signal }).warn('song request sidecar exited')
    })

    if (await waitForReady(nextBridge) && child === handle && bridge === nextBridge)
      return

    if (child === handle) {
      child = undefined
      bridge = undefined
    }
    handle.kill()
    throw new Error('The song request sidecar did not become ready.')
  }

  async function start() {
    if (child && bridge)
      return
    if (!startPromise) {
      startPromise = startProcess().finally(() => {
        startPromise = undefined
      })
    }
    await startPromise
  }

  async function stop() {
    const handle = child
    child = undefined
    bridge = undefined
    if (!handle || handle.killed)
      return

    handle.kill()
    await new Promise<void>((resolveExit) => {
      const timer = setTimeout(resolveExit, STOP_TIMEOUT_MS)
      handle.once('exit', () => {
        clearTimeout(timer)
        resolveExit()
      })
    })
  }

  async function bridgeFetch<TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
    schema: TSchema,
    path: string,
    options: { method?: string, body?: unknown, timeoutMs?: number, failureMessage: string },
  ): Promise<InferOutput<TSchema>> {
    await start()
    const activeBridge = bridge
    if (!activeBridge)
      throw new Error('The song request sidecar is unavailable.')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? LOGIN_TIMEOUT_MS)
    try {
      const response = await fetch(`${activeBridge.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${activeBridge.token}`,
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        let message = `${options.failureMessage} (status ${response.status})`
        try {
          message = parse(errorSchema, payload).error
        }
        catch {
          // Keep the HTTP status when the sidecar returned an invalid error body.
        }
        throw new Error(message)
      }
      return parse(schema, payload)
    }
    catch (error) {
      throw new Error(errorMessageFrom(error) ?? options.failureMessage)
    }
    finally {
      clearTimeout(timeout)
    }
  }

  async function resolve(input: SongRequestResolveInput): Promise<SongRequestTrack> {
    return await bridgeFetch(trackSchema, '/v1/resolve', {
      method: 'POST',
      body: input,
      timeoutMs: RESOLVE_TIMEOUT_MS,
      failureMessage: 'The song search failed.',
    })
  }

  async function loginQrCreate(source: string): Promise<SongRequestQrLoginSession> {
    return await bridgeFetch(qrLoginSessionSchema, '/v1/login/qr', {
      method: 'POST',
      body: { source },
      failureMessage: 'Could not create the login QR code.',
    })
  }

  async function loginQrCheck(source: string, key: string): Promise<SongRequestQrLoginCheckResult> {
    return await bridgeFetch(
      qrLoginCheckSchema,
      `/v1/login/qr/${encodeURIComponent(source)}?key=${encodeURIComponent(key)}`,
      { failureMessage: 'Could not check the login state.' },
    )
  }

  async function loginState(): Promise<SongRequestLoginState> {
    return await bridgeFetch(loginStateSchema, '/v1/login/status', {
      failureMessage: 'Could not read the account state.',
    })
  }

  async function loginClear(source: string): Promise<SongRequestLoginState> {
    return await bridgeFetch(loginStateSchema, `/v1/login/${encodeURIComponent(source)}`, {
      method: 'DELETE',
      failureMessage: 'Could not sign out.',
    })
  }

  onAppBeforeQuit(() => stop())

  return { start, stop, resolve, loginQrCreate, loginQrCheck, loginState, loginClear }
}
