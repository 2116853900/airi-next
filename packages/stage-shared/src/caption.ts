export const CAPTION_OVERLAY_CHANNEL = 'airi-caption-overlay'

export type CaptionChannelEvent
  = | { type: 'caption-speaker', text: string }
    | { type: 'caption-assistant', text: string }
    | {
      type: 'caption-live-chat'
      id: string
      username: string
      text: string
      avatar?: string
      color?: string
    }

/** Broadcast channel carrying live-chat danmaku to the dedicated overlay window. */
export const LIVE_CHAT_OVERLAY_CHANNEL = 'airi-live-chat-overlay'

export interface LiveChatOverlayMessage {
  /** Stable render key for one danmaku message. */
  id: string
  username: string
  text: string
  avatar?: string
  color?: string
  /** User level on the platform. */
  level?: number
}
