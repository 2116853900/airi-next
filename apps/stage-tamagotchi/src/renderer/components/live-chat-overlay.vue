<script setup lang="ts">
import type { CaptionItem } from '../composables/useCaptionItems'

import { computed } from 'vue'

const props = withDefaults(defineProps<{
  items: readonly CaptionItem[]
  /** How many live chat messages stay visible at once. */
  maxItems?: number
  /** Message font size in pixels. */
  fontSize?: number
  /** Message background opacity, 0..1. */
  opacity?: number
}>(), {
  maxItems: 3,
  fontSize: 14,
  opacity: 0.72,
})

const visibleItems = computed(() => props.items
  .filter(item => item.type === 'caption-live-chat')
  .slice(-props.maxItems))
</script>

<template>
  <TransitionGroup
    name="live-chat"
    tag="div"
    aria-live="polite"
    :class="[
      'w-full flex flex-col items-start gap-1.5',
    ]"
  >
    <div
      v-for="item in visibleItems"
      :key="item.id"
      :class="[
        'max-w-full min-h-8 flex items-center gap-2 overflow-hidden',
        'border-l-3 rounded-md px-2.5 py-1.5 shadow-md backdrop-blur-sm',
        'text-neutral-50',
      ]"
      :style="{
        borderColor: item.color,
        backgroundColor: `rgb(10 10 10 / ${props.opacity})`,
        fontSize: `${props.fontSize}px`,
      }"
    >
      <img
        v-if="item.avatar"
        :src="item.avatar"
        :alt="item.username"
        :class="[
          'h-5 w-5 shrink-0 rounded-full object-cover',
        ]"
      >
      <span :class="['shrink-0 font-semibold text-primary-200']">
        {{ item.username }}
      </span>
      <span :class="['min-w-0 break-words leading-5']">
        {{ item.text }}
      </span>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.live-chat-enter-active,
.live-chat-leave-active,
.live-chat-move {
  transition: opacity 180ms ease, transform 180ms ease;
}

.live-chat-enter-from,
.live-chat-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
