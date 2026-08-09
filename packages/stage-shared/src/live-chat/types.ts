export type LiveRoomPlatform = 'bilibili' | 'douyin'

export interface LiveRoomConfig {
  /** Stable local id used as the eventa/timer owner for one room. */
  id: string
  platform: LiveRoomPlatform
  roomId: string
  enabled: boolean
}

export type LiveRoomConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'stopped'

export interface LiveRoomStatus {
  state: LiveRoomConnectionState
  error?: string
  updatedAt: number
}

/**
 * The effective UniBarrage bridge the connectors dial.
 *
 * The app spawns UniBarrage as a managed child process and derives this from
 * the running instance's ports and API token; it is not user-configured.
 */
export interface UniBarrageBridgeConfig {
  /** UniBarrage WebSocket push endpoint, e.g. ws://127.0.0.1:<wsPort>. */
  url: string
  /** UniBarrage HTTP API base, e.g. http://127.0.0.1:<apiPort>. */
  apiUrl: string
  /** Bearer token for the UniBarrage HTTP API. */
  token?: string
}

export type UniBarrageState = 'stopped' | 'starting' | 'running' | 'error'

export interface UniBarrageStatus {
  state: UniBarrageState
  pid?: number
  wsUrl?: string
  apiUrl?: string
  error?: string
  updatedAt: number
}

export interface LiveChatSnapshot {
  rooms: Array<LiveRoomConfig & { status: LiveRoomStatus }>
  unibarrageBridge: UniBarrageBridgeConfig
}
