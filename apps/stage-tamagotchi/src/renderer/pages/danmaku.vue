<script setup lang="ts">
import type { LiveChatOverlayMessage } from '@proj-airi/stage-shared'

import { LIVE_CHAT_OVERLAY_CHANNEL } from '@proj-airi/stage-shared'
import { shouldDisplayLiveChatMessage } from '@proj-airi/stage-shared/live-chat'
import { useSettingsLiveChat } from '@proj-airi/stage-ui/stores/settings'
import { useBroadcastChannel } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import OverlayWindowHandles from '../components/overlay-window-handles.vue'

interface DanmakuItem {
  id: number
  text: string
  username?: string
  color?: string
  level?: number
}

const MAX_ITEMS = 50

const {
  fontSize,
  bgOpacity,
  textColor,
  showLevel,
  msgBgColor,
  msgBgOpacity,
  levelColors,
  dedupeEnabled,
  dedupeWindowMs,
  dedupeMaxRepeats,
} = storeToRefs(useSettingsLiveChat())

const items = ref<DanmakuItem[]>([])
const listEl = ref<HTMLElement | null>(null)
let nextId = 1

/** Timestamps of recent occurrences per danmaku text for repeat suppression. */
const seenAt = new Map<string, number[]>()

const { data } = useBroadcastChannel<LiveChatOverlayMessage, LiveChatOverlayMessage>({ name: LIVE_CHAT_OVERLAY_CHANNEL })

/** Overlay background style. */
const bgStyle = computed(() => ({
  backgroundColor: `rgba(10, 10, 10, ${bgOpacity.value})`,
}))

/** Parsed level-to-color mapping. */
const levelColorMap = computed<Record<string, string>>(() => {
  try {
    return JSON.parse(levelColors.value)
  }
  catch {
    return {}
  }
})

/** Returns the text color for a danmaku item, considering level-based overrides. */
function itemTextColor(item: DanmakuItem): string {
  if (item.level != null) {
    const levelColor = levelColorMap.value[String(item.level)]
    if (levelColor)
      return levelColor
  }
  return textColor.value
}

/** Returns the per-message background style with opacity. */
function msgBgStyle(): string {
  return `rgba(${hexToRgb(msgBgColor.value)}, ${msgBgOpacity.value})`
}

/** Convert hex color to rgb components string. */
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '')
  if (clean.length === 3) {
    const r = Number.parseInt(clean[0]! + clean[0], 16)
    const g = Number.parseInt(clean[1]! + clean[1], 16)
    const b = Number.parseInt(clean[2]! + clean[2], 16)
    return `${r}, ${g}, ${b}`
  }
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

function pushMessage(event: LiveChatOverlayMessage | null) {
  if (!event)
    return
  const text = event.text.trim()
  if (!text)
    return

  if (dedupeEnabled.value && !shouldDisplayLiveChatMessage(seenAt, text, Date.now(), dedupeWindowMs.value, dedupeMaxRepeats.value))
    return

  const item: DanmakuItem = {
    id: nextId++,
    text,
    username: event.username,
    color: event.color,
    level: event.level,
  }
  items.value = [...items.value, item]
  if (items.value.length > MAX_ITEMS)
    items.value = items.value.slice(-MAX_ITEMS)

  // Auto-scroll to the latest message
  nextTick(() => {
    if (listEl.value) {
      listEl.value.scrollTop = listEl.value.scrollHeight
    }
  })
}

onMounted(() => {
  watch(data, pushMessage)
})
</script>

<template>
  <div
    class="[-webkit-app-region:drag] relative h-full w-full select-none overflow-hidden backdrop-blur-[2px]"
    :style="bgStyle"
  >
    <!-- Empty state indicator -->
    <div
      v-if="items.length === 0"
      class="absolute inset-0 flex items-center justify-center text-xs"
      :style="{ color: textColor }"
      :class="{ 'opacity-60': true }"
    >
      <span class="flex items-center gap-1.5">
        <span class="inline-block h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: textColor }" :class="{ 'opacity-40': true }" />
        等待弹幕...
      </span>
    </div>

    <!-- Vertical danmaku list -->
    <div
      ref="listEl"
      class="h-full flex flex-col overflow-y-auto px-2 py-1"
    >
      <TransitionGroup
        name="danmaku"
        tag="div"
        class="mt-auto flex flex-col gap-1"
      >
        <div
          v-for="item in items"
          :key="item.id"
          class="danmaku-line"
          :style="{
            fontSize: `${fontSize}px`,
            color: itemTextColor(item),
            backgroundColor: msgBgStyle(),
          }"
        >
          <!-- User level badge -->
          <span
            v-if="showLevel && item.level != null"
            class="mr-1 shrink-0 rounded px-1 text-[0.7em] font-bold leading-relaxed"
            :style="{
              backgroundColor: item.color || 'rgba(255,255,255,0.15)',
              color: '#fff',
            }"
          >
            Lv.{{ item.level }}
          </span>
          <span
            v-if="item.username"
            class="mr-1 shrink-0 font-semibold"
            :style="item.color ? { color: item.color } : undefined"
          >
            {{ item.username }}:
          </span>
          <span class="whitespace-pre-wrap break-words">{{ item.text }}</span>
        </div>
      </TransitionGroup>
    </div>

    <OverlayWindowHandles />
  </div>
</template>

<style scoped>
.danmaku-line {
  display: flex;
  align-items: baseline;
  line-height: 1.5;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.8);
  border-radius: 4px;
  padding: 1px 6px;
}

.danmaku-enter-active {
  transition: all 0.25s ease-out;
}

.danmaku-leave-active {
  transition: all 0.3s ease-in;
}

.danmaku-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.danmaku-leave-to {
  opacity: 0;
}

.danmaku-move {
  transition: transform 0.3s ease;
}
</style>

<route lang="yaml">
meta:
  layout: stage
</route>
