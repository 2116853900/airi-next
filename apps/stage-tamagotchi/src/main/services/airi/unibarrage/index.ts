import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

import type { UniBarrageBridgeConfig, UniBarrageStatus } from '@proj-airi/stage-shared/live-chat'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'

import { useLogg } from '@guiiai/logg'
import { errorMessageFrom } from '@moeru/std'
import { app } from 'electron'
import { getRandomPort } from 'get-port-please'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'
import { getElectronMainDirname } from '../../../libs/electron/location'
import { buildSpawnArgs, devBinaryPath, packagedBinaryPath } from './paths'

const READY_TIMEOUT_MS = 10_000
const READY_POLL_MS = 500
const STOP_TIMEOUT_MS = 2_000

export interface UniBarrageManager {
  start: () => Promise<void>
  stop: () => Promise<void>
  getStatus: () => UniBarrageStatus
  getBridge: () => UniBarrageBridgeConfig | undefined
  onStatusChange: (listener: (status: UniBarrageStatus) => void) => () => void
}

/** Re-exports for consumers that only need binary path/args helpers. */
export { binaryNameForPlatform, buildSpawnArgs, devBinaryPath, engineOsForPlatform, packagedBinaryPath } from './paths'

/**
 * Owns the bundled UniBarrage sidecar process.
 *
 * The manager resolves the binary (packaged resources vs dev engine output),
 * spawns it on free ports with a fresh API token, waits for the API to answer
 * `/api/v1/`, and exposes the effective bridge config so the live-chat
 * connector can register rooms. The process is killed on app quit.
 *
 * State model:
 *
 * - `stopped` -> `starting` -> `running`; `starting`/`running` -> `error` on
 *   spawn failure, early exit, or a readiness timeout. `stop()` always returns
 *   to `stopped`.
 * - `bridge` is only set while a process is expected to be answering; it is
 *   cleared on `exit`/`error`/`stop` so a stale URL is never dialed.
 */
export function setupUniBarrageManager(): UniBarrageManager {
  const log = useLogg('main/unibarrage').useGlobalConfig()
  const statusListeners = new Set<(status: UniBarrageStatus) => void>()
  let child: ChildProcess | undefined
  let status: UniBarrageStatus = { state: 'stopped', updatedAt: Date.now() }
  let bridge: UniBarrageBridgeConfig | undefined

  function setStatus(next: UniBarrageStatus) {
    status = next
    for (const listener of statusListeners) {
      try {
        listener(status)
      }
      catch (error) {
        log.withError(error).warn('failed to publish UniBarrage status change')
      }
    }
  }

  function pipeLog(stream: Readable | null, level: 'debug' | 'warn') {
    if (!stream)
      return
    stream.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf-8').trim()
      if (message) {
        if (level === 'warn')
          log.warn(message)
        else
          log.debug(message)
      }
    })
  }

  async function waitForReady(apiUrl: string, token: string): Promise<boolean> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${apiUrl}/api/v1/`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (response.ok)
          return true
      }
      catch {
        // API not up yet; keep polling.
      }
      await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
    }
    return false
  }

  async function resolveBinary(): Promise<string> {
    if (app.isPackaged) {
      const path = packagedBinaryPath(process.platform, process.resourcesPath)
      try {
        await access(path)
        return path
      }
      catch {
        throw new Error(`UniBarrage binary not found. Expected at: ${path}`)
      }
    }

    const envPath = process.env.UNIBARRAGE_BIN?.trim()
    if (envPath) {
      try {
        await access(envPath)
        return envPath
      }
      catch {
        throw new Error(`UNIBARRAGE_BIN points to a missing UniBarrage binary: ${envPath}`)
      }
    }

    const devPath = await devBinaryPath(process.platform, getElectronMainDirname())
    if (devPath)
      return devPath

    throw new Error(
      'UniBarrage binary not found for dev mode. '
      + 'Build it once with: pnpm -F @proj-airi/stage-tamagotchi-unibarrage build',
    )
  }

  async function start() {
    if (child && !child.killed)
      return
    if (status.state === 'starting' || status.state === 'running')
      return

    let binary: string
    try {
      binary = await resolveBinary()
    }
    catch (error) {
      setStatus({ state: 'error', error: errorMessageFrom(error) ?? 'UniBarrage binary is missing', updatedAt: Date.now() })
      return
    }
    const wsPort = await getRandomPort('127.0.0.1')
    const apiPort = await getRandomPort('127.0.0.1')
    const token = randomUUID()
    const nextBridge: UniBarrageBridgeConfig = {
      url: `ws://127.0.0.1:${wsPort}`,
      apiUrl: `http://127.0.0.1:${apiPort}`,
      token,
    }
    bridge = nextBridge

    setStatus({ state: 'starting', updatedAt: Date.now() })
    log.withFields({ wsPort, apiPort }).debug('spawning UniBarrage sidecar')

    let handle: ChildProcess
    try {
      handle = spawn(binary, buildSpawnArgs({ wsPort, apiPort, token }), { stdio: ['ignore', 'pipe', 'pipe'] })
    }
    catch (error) {
      bridge = undefined
      setStatus({ state: 'error', error: errorMessageFrom(error) ?? 'Failed to spawn UniBarrage', updatedAt: Date.now() })
      return
    }
    child = handle

    pipeLog(handle.stdout, 'debug')
    pipeLog(handle.stderr, 'warn')

    handle.on('error', (error) => {
      bridge = undefined
      child = undefined
      setStatus({ state: 'error', error: errorMessageFrom(error) ?? 'UniBarrage process error', updatedAt: Date.now() })
    })
    handle.on('exit', (code, signal) => {
      bridge = undefined
      child = undefined
      if (status.state === 'starting' || status.state === 'running') {
        setStatus({
          state: 'error',
          error: `UniBarrage exited unexpectedly (code=${code}, signal=${signal})`,
          updatedAt: Date.now(),
        })
      }
    })

    const ready = await waitForReady(nextBridge.apiUrl, token)
    if (handle !== child || bridge !== nextBridge)
      return // stopped or restarted while waiting
    if (!ready) {
      handle.kill()
      setStatus({ state: 'error', error: 'UniBarrage did not become ready within timeout', updatedAt: Date.now() })
      return
    }
    setStatus({
      state: 'running',
      pid: handle.pid,
      wsUrl: nextBridge.url,
      apiUrl: nextBridge.apiUrl,
      updatedAt: Date.now(),
    })
  }

  async function stop() {
    const handle = child
    child = undefined
    bridge = undefined
    if (!handle || handle.killed) {
      setStatus({ state: 'stopped', updatedAt: Date.now() })
      return
    }
    handle.kill()
    await new Promise<void>((resolveExit) => {
      const timer = setTimeout(resolveExit, STOP_TIMEOUT_MS)
      handle.once('exit', () => {
        clearTimeout(timer)
        resolveExit()
      })
    })
    setStatus({ state: 'stopped', updatedAt: Date.now() })
  }

  onAppBeforeQuit(() => stop())

  return {
    start,
    stop,
    getStatus: () => status,
    getBridge: () => bridge,
    onStatusChange: (listener) => {
      statusListeners.add(listener)
      return () => {
        statusListeners.delete(listener)
      }
    },
  }
}
