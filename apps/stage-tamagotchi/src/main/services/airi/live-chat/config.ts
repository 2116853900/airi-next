import type { LiveRoomConfig } from '@proj-airi/stage-shared/live-chat'
import type { InferOutput } from 'valibot'

import { array, boolean, literal, object, string, union } from 'valibot'

import { createConfig } from '../../../libs/electron/persistence'

export const liveChatConfigSchema = object({
  rooms: array(object({
    id: string(),
    platform: union([literal('bilibili'), literal('douyin')]),
    roomId: string(),
    enabled: boolean(),
  })),
})

export type LiveChatConfig = InferOutput<typeof liveChatConfigSchema>

export function createLiveChatConfigStore() {
  const store = createConfig('live-chat', 'config.json', liveChatConfigSchema, {
    default: { rooms: [] },
    autoHeal: true,
  })
  store.setup()

  function get(): LiveChatConfig {
    return store.get() ?? { rooms: [] }
  }

  function updateRooms(rooms: LiveRoomConfig[]) {
    store.update({ ...get(), rooms })
  }

  return { get, updateRooms }
}
