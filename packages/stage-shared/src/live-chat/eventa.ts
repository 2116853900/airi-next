import type { LiveRoomConfig, LiveRoomStatus, UniBarrageStatus } from './types'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

// Invokes (renderer -> main)
export const liveChatListRoomsInvokeEventa = defineInvokeEventa<LiveRoomConfig[]>('eventa:invoke:electron:live-chat:list-rooms')
export const liveChatAddRoomInvokeEventa = defineInvokeEventa<LiveRoomConfig, { platform: LiveRoomConfig['platform'], roomId: string }>('eventa:invoke:electron:live-chat:add-room')
export const liveChatRemoveRoomInvokeEventa = defineInvokeEventa<void, string>('eventa:invoke:electron:live-chat:remove-room')
export const liveChatUpdateRoomInvokeEventa = defineInvokeEventa<LiveRoomConfig, { id: string, patch: Partial<Pick<LiveRoomConfig, 'roomId'>> }>('eventa:invoke:electron:live-chat:update-room')
export const liveChatSetEnabledInvokeEventa = defineInvokeEventa<LiveRoomConfig, { id: string, enabled: boolean }>('eventa:invoke:electron:live-chat:set-enabled')
export const liveChatGetStatusInvokeEventa = defineInvokeEventa<Record<string, LiveRoomStatus>>('eventa:invoke:electron:live-chat:get-status')
export const unibarrageGetStatusInvokeEventa = defineInvokeEventa<UniBarrageStatus>('eventa:invoke:electron:live-chat:unibarrage-status')

// Events (main -> renderer)
export const liveChatStatusChangedInvokeEventa = defineEventa<Record<string, LiveRoomStatus>>('eventa:event:electron:live-chat:status-changed')
export const unibarrageStatusChangedInvokeEventa = defineEventa<UniBarrageStatus>('eventa:event:electron:live-chat:unibarrage-status-changed')
