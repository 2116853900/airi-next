import type { ClientInterface, MessageBus } from '@deltachat/dbus-next'

import type { MprisPlayerInfo, MprisTrackMetadata } from './mpris-metadata'

import { sessionBus } from '@deltachat/dbus-next'
import { useLogg } from '@guiiai/logg'

import { mapMprisMetadata, microsecondsToMilliseconds, normalizePlaybackStatus, pickActivePlayer, unwrapVariant } from './mpris-metadata'

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.'
const MPRIS_OBJECT_PATH = '/org/mpris/MediaPlayer2'
const MPRIS_PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player'
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties'
const DBUS_SERVICE = 'org.freedesktop.DBus'
const DBUS_OBJECT_PATH = '/org/freedesktop/DBus'
const DBUS_INTERFACE = 'org.freedesktop.DBus'

export interface MprisPlayer {
  name: string
  playbackStatus: 'playing' | 'paused' | 'stopped'
  track: MprisTrackMetadata | null
  positionMs: number
}

export interface MprisProvider {
  start: () => Promise<void>
  stop: () => void
  getActivePlayer: () => MprisPlayer | null
  refresh: () => Promise<void>
  onActivePlayerChanged: (listener: (player: MprisPlayer | null) => void) => () => void
}

interface PlayerHandle {
  name: string
  properties: ClientInterface
  onPropertiesChanged: () => void
  onSeeked: (positionUs: unknown) => void
}

/**
 * Watches MPRIS media players on the session bus via `@deltachat/dbus-next`
 * (a pure-JS dbus-next fork, so no native module rebuilds are needed).
 *
 * Emits the active player snapshot whenever metadata, playback status, or
 * position changes; `refresh()` re-reads the active player on demand so the
 * engine can anchor position periodically.
 */
export function createMprisProvider(): MprisProvider {
  const log = useLogg('main/now-playing/mpris').useGlobalConfig()
  let bus: MessageBus | undefined
  let daemonInterface: ClientInterface | undefined
  const players = new Map<string, PlayerHandle>()
  const listeners = new Set<(player: MprisPlayer | null) => void>()
  let activePlayer: MprisPlayer | null = null
  let started = false
  let reconciling = false

  function emit(player: MprisPlayer | null) {
    activePlayer = player
    for (const listener of listeners) {
      try {
        listener(player)
      }
      catch (error) {
        log.withError(error).warn('failed to publish MPRIS player change')
      }
    }
  }

  function ensureBus(): MessageBus {
    if (bus)
      return bus

    const nextBus = sessionBus()
    nextBus.on('error', (error) => {
      log.withError(error).warn('MPRIS session bus error')
    })
    bus = nextBus
    return nextBus
  }

  async function listPlayerNames(): Promise<string[]> {
    try {
      const daemon = await ensureBus().getProxyObject(DBUS_SERVICE, DBUS_OBJECT_PATH)
      daemonInterface = daemon.getInterface(DBUS_INTERFACE)
      const names = await daemonInterface.ListNames()
      return (Array.isArray(names) ? names : [])
        .filter((name): name is string => typeof name === 'string' && name.startsWith(MPRIS_PREFIX))
    }
    catch (error) {
      log.withError(error).debug('failed to list MPRIS players')
      return []
    }
  }

  async function readPlayerInfo(name: string): Promise<MprisPlayerInfo | null> {
    const handle = players.get(name)
    if (!handle)
      return null

    try {
      const raw = await handle.properties.GetAll(MPRIS_PLAYER_INTERFACE)
      const unwrapped = unwrapVariant(raw) as Record<string, unknown>
      return {
        name,
        playbackStatus: normalizePlaybackStatus(unwrapped.PlaybackStatus),
        metadata: (unwrapped.Metadata as Record<string, unknown>) ?? {},
      }
    }
    catch (error) {
      log.withError(error).debug(`failed to read MPRIS player ${name}`)
      return null
    }
  }

  async function readPositionMs(name: string): Promise<number | undefined> {
    const handle = players.get(name)
    if (!handle)
      return undefined

    try {
      const raw = await handle.properties.Get(MPRIS_PLAYER_INTERFACE, 'Position')
      return microsecondsToMilliseconds(unwrapVariant(raw))
    }
    catch {
      return undefined
    }
  }

  async function addPlayer(name: string) {
    if (players.has(name))
      return

    try {
      const proxy = await ensureBus().getProxyObject(name, MPRIS_OBJECT_PATH)
      const properties = proxy.getInterface(PROPERTIES_INTERFACE)
      const playerInterface = proxy.getInterface(MPRIS_PLAYER_INTERFACE)

      const onPropertiesChanged = () => {
        void reconcile()
      }
      const onSeeked = (positionUs: unknown) => {
        // Seeked gives a fresh position anchor without a full re-read.
        const current = activePlayer
        const positionMs = microsecondsToMilliseconds(positionUs)
        if (current?.name === name && positionMs != null) {
          emit({ ...current, positionMs })
        }
      }

      properties.on('PropertiesChanged', onPropertiesChanged)
      playerInterface.on('Seeked', onSeeked)

      players.set(name, { name, properties, onPropertiesChanged, onSeeked })
    }
    catch (error) {
      log.withError(error).debug(`failed to connect MPRIS player ${name}`)
      players.delete(name)
    }
  }

  function removePlayer(name: string) {
    const handle = players.get(name)
    if (!handle)
      return

    handle.properties.off('PropertiesChanged', handle.onPropertiesChanged)
    players.delete(name)
  }

  async function reconcile() {
    if (reconciling)
      return
    reconciling = true

    try {
      const infos: MprisPlayerInfo[] = []
      for (const name of players.keys()) {
        const info = await readPlayerInfo(name)
        if (info)
          infos.push(info)
      }

      const picked = pickActivePlayer(infos)
      const next: MprisPlayer | null = picked
        ? {
            name: picked.name,
            playbackStatus: picked.playbackStatus,
            track: mapMprisMetadata(picked.metadata),
            positionMs: await readPositionMs(picked.name) ?? 0,
          }
        : null

      emit(next)
    }
    finally {
      reconciling = false
    }
  }

  async function syncPlayerList() {
    const names = await listPlayerNames()
    const known = new Set(players.keys())
    for (const name of names) {
      if (!known.has(name))
        await addPlayer(name)
    }
    for (const name of known) {
      if (!names.includes(name))
        removePlayer(name)
    }
  }

  function subscribeDaemonSignals() {
    if (!daemonInterface)
      return

    daemonInterface.on('NameOwnerChanged', (name: unknown, _oldOwner: unknown, _newOwner: unknown) => {
      if (typeof name !== 'string' || !name.startsWith(MPRIS_PREFIX))
        return
      // Re-list instead of trusting the args so per-instance names and owner
      // changes both reconcile correctly.
      void syncPlayerList().then(() => reconcile())
    })
  }

  return {
    async start() {
      if (started)
        return
      started = true
      await syncPlayerList()
      subscribeDaemonSignals()
      await reconcile()
    },

    stop() {
      if (!started)
        return
      started = false

      for (const name of players.keys())
        removePlayer(name)
      players.clear()
      daemonInterface = undefined
      activePlayer = null
      bus?.disconnect()
      bus = undefined
    },

    getActivePlayer() {
      return activePlayer
    },

    async refresh() {
      if (!started)
        return
      await reconcile()
    },

    onActivePlayerChanged(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
