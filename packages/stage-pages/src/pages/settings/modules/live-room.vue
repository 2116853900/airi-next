<script setup lang="ts">
import type { LiveRoomConfig, LiveRoomStatus, UniBarrageStatus } from '@proj-airi/stage-shared/live-chat'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { errorMessageFrom } from '@moeru/std'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import {
  liveChatAddRoomInvokeEventa,
  liveChatGetStatusInvokeEventa,
  liveChatListRoomsInvokeEventa,
  liveChatRemoveRoomInvokeEventa,
  liveChatSetEnabledInvokeEventa,
  liveChatStatusChangedInvokeEventa,
  unibarrageGetStatusInvokeEventa,
  unibarrageStatusChangedInvokeEventa,
} from '@proj-airi/stage-shared/live-chat'
import { Button, FieldCheckbox, FieldInput, GhostButton, SelectTab } from '@proj-airi/ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const isDesktop = isStageTamagotchi()

const platformOptions = computed(() => [
  { label: 'Bilibili', value: 'bilibili' as const },
  { label: 'Douyin', value: 'douyin' as const },
])

const rooms = ref<LiveRoomConfig[]>([])
const statusByRoom = ref<Record<string, LiveRoomStatus>>({})

const newPlatform = ref<'bilibili' | 'douyin'>('bilibili')
const newRoomId = ref('')
const addingError = ref('')

const unibarrageStatus = ref<UniBarrageStatus | undefined>(undefined)

let removeStatusListener: (() => void) | undefined
let removeUniBarrageStatusListener: (() => void) | undefined
let listRooms: (() => Promise<LiveRoomConfig[]>) | undefined
let addRoom: ((input: { platform: 'bilibili' | 'douyin', roomId: string }) => Promise<LiveRoomConfig>) | undefined
let removeRoom: ((id: string) => Promise<void>) | undefined
let setEnabled: ((input: { id: string, enabled: boolean }) => Promise<LiveRoomConfig>) | undefined
let getUniBarrageStatus: (() => Promise<UniBarrageStatus>) | undefined

function roomStatus(room: LiveRoomConfig) {
  return statusByRoom.value[room.id]
}

function unibarrageStateColor(state?: UniBarrageStatus['state']): string {
  switch (state) {
    case 'running':
      return 'text-green-400'
    case 'starting':
      return 'text-yellow-400'
    case 'error':
      return 'text-red-400'
    default:
      return 'text-neutral-500'
  }
}

function getElectronIpcRenderer() {
  return (window as Window & {
    electron?: { ipcRenderer?: unknown }
  }).electron?.ipcRenderer
}

async function refreshRooms() {
  if (!listRooms)
    return
  try {
    rooms.value = await listRooms()
  }
  catch (error) {
    addingError.value = errorMessageFrom(error) ?? t('settings.pages.modules.live_room.rooms.add.error.failed')
  }
}

async function onAddRoom() {
  addingError.value = ''
  const roomId = newRoomId.value.trim()
  if (!roomId) {
    addingError.value = t('settings.pages.modules.live_room.rooms.add.error.required')
    return
  }
  if (!addRoom) {
    addingError.value = t('settings.pages.modules.live_room.rooms.add.error.failed')
    return
  }

  try {
    await addRoom({ platform: newPlatform.value, roomId })
    newRoomId.value = ''
    await refreshRooms()
  }
  catch (error) {
    addingError.value = errorMessageFrom(error) ?? t('settings.pages.modules.live_room.rooms.add.error.failed')
  }
}

onMounted(async () => {
  if (!isDesktop)
    return

  const ipcRenderer = getElectronIpcRenderer()
  if (!ipcRenderer)
    return

  const { context } = createContext(ipcRenderer as Parameters<typeof createContext>[0])
  listRooms = defineInvoke(context, liveChatListRoomsInvokeEventa)
  addRoom = defineInvoke(context, liveChatAddRoomInvokeEventa)
  removeRoom = defineInvoke(context, liveChatRemoveRoomInvokeEventa)
  setEnabled = defineInvoke(context, liveChatSetEnabledInvokeEventa)
  getUniBarrageStatus = defineInvoke(context, unibarrageGetStatusInvokeEventa)
  const getStatus = defineInvoke(context, liveChatGetStatusInvokeEventa)

  removeStatusListener = context.on(liveChatStatusChangedInvokeEventa, (event) => {
    if (event?.body)
      statusByRoom.value = event.body
  })
  removeUniBarrageStatusListener = context.on(unibarrageStatusChangedInvokeEventa, (event) => {
    if (event?.body)
      unibarrageStatus.value = event.body
  })

  try {
    rooms.value = await listRooms()
    statusByRoom.value = await getStatus()
    unibarrageStatus.value = await getUniBarrageStatus()
  }
  catch {}
})

onUnmounted(() => {
  removeStatusListener?.()
  removeStatusListener = undefined
  removeUniBarrageStatusListener?.()
  removeUniBarrageStatusListener = undefined
})
</script>

<template>
  <div flex="~ col gap-6">
    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
          {{ t('settings.pages.modules.live_room.rooms.title') }}
        </h2>
        <div text="neutral-400 dark:neutral-400">
          <span>{{ t('settings.pages.modules.live_room.rooms.description') }}</span>
        </div>
      </div>

      <div v-if="rooms.length === 0" text="neutral-400 dark:neutral-400">
        <span>{{ t('settings.pages.modules.live_room.rooms.empty') }}</span>
      </div>

      <div flex="~ col gap-2">
        <div
          v-for="room in rooms"
          :key="room.id"
          flex="~ row gap-3 items-center"
          rounded-lg
          bg="neutral-200/60 dark:[rgba(255,255,255,0.04)]"
          px-3 py-2
        >
          <span
            :class="[
              'shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase',
              room.platform === 'bilibili' ? 'bg-pink-500/20 text-pink-300' : 'bg-neutral-500/20 text-neutral-300',
            ]"
          >
            {{ room.platform }}
          </span>
          <span class="min-w-0 flex-1 truncate text-sm text-neutral-100 font-mono">
            {{ room.roomId }}
          </span>
          <span
            :class="[
              'shrink-0 text-xs',
              roomStatus(room)?.state === 'connected' ? 'text-green-400' : roomStatus(room)?.state === 'error' ? 'text-red-400' : 'text-neutral-500',
            ]"
          >
            {{ t(`settings.pages.modules.live_room.rooms.state.${roomStatus(room)?.state ?? 'idle'}`) }}
          </span>
          <FieldCheckbox
            :model-value="room.enabled"
            :label="undefined"
            @update:model-value="value => setEnabled?.({ id: room.id, enabled: value })?.then(refreshRooms)"
          />
          <GhostButton
            size="sm"
            @click="removeRoom?.(room.id)?.then(refreshRooms)"
          >
            {{ t('settings.pages.modules.live_room.rooms.remove') }}
          </GhostButton>
        </div>
      </div>

      <div flex="~ row gap-3 items-end wrap">
        <SelectTab v-model="newPlatform" :options="platformOptions" />
        <div class="min-w-40 flex-1">
          <FieldInput
            v-model="newRoomId"
            :label="t('settings.pages.modules.live_room.rooms.add.room_id')"
            :placeholder="t('settings.pages.modules.live_room.rooms.add.room_id_placeholder')"
          />
        </div>
        <Button @click="onAddRoom">
          {{ t('settings.pages.modules.live_room.rooms.add.action') }}
        </Button>
      </div>
      <div v-if="addingError" text="red-400" text-sm>
        <span>{{ addingError }}</span>
      </div>
    </div>

    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
          {{ t('settings.pages.modules.live_room.unibarrage.title') }}
        </h2>
        <div text="neutral-400 dark:neutral-400">
          <span>{{ t('settings.pages.modules.live_room.unibarrage.description') }}</span>
        </div>
      </div>

      <div flex="~ row gap-3 items-center">
        <span
          :class="['shrink-0 text-sm font-semibold', unibarrageStateColor(unibarrageStatus?.state)]"
        >
          {{ t(`settings.pages.modules.live_room.unibarrage.state.${unibarrageStatus?.state ?? 'stopped'}`) }}
        </span>
        <span
          v-if="unibarrageStatus?.state === 'running' && unibarrageStatus.wsUrl && unibarrageStatus.apiUrl"
          text="neutral-400 text-xs"
        >
          {{ t('settings.pages.modules.live_room.unibarrage.ports', { ws: unibarrageStatus.wsUrl, api: unibarrageStatus.apiUrl }) }}
        </span>
      </div>

      <div v-if="unibarrageStatus?.state === 'error' && unibarrageStatus.error" text="red-400 text-sm">
        <span>{{ unibarrageStatus.error }} · {{ t('settings.pages.modules.live_room.unibarrage.error_hint') }}</span>
      </div>
    </div>

    <div
      v-if="!isDesktop"
      text="neutral-400 dark:neutral-400"
    >
      <span>{{ t('settings.pages.modules.live_room.desktop_only') }}</span>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.live_room.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
