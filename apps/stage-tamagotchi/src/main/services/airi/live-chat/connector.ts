import type { WebSocketEventInputLiveChat } from '@proj-airi/server-sdk'
import type { LiveRoomStatus } from '@proj-airi/stage-shared/live-chat'

export interface LiveRoomConnectorCallbacks {
  onMessage: (message: WebSocketEventInputLiveChat) => void
  onStatus: (roomId: string, status: LiveRoomStatus) => void
}

export interface LiveRoomConnector {
  /** Reconciles connections with the current set of enabled rooms. */
  sync: () => void
  /** Disconnects everything and releases timers. */
  stop: () => void
}
