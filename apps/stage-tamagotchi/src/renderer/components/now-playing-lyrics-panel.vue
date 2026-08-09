<script setup lang="ts">
import type { NowPlayingState } from '@proj-airi/stage-shared/now-playing'

import { defineInvoke } from '@moeru/eventa'
import { useElectronEventaContext } from '@proj-airi/electron-vueuse'
import { findCurrentLineIndex, nowPlayingGetStateInvokeEventa, nowPlayingStateChangedInvokeEventa } from '@proj-airi/stage-shared/now-playing'
import { useSettingsNowPlaying } from '@proj-airi/stage-ui/stores/settings'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/** Local re-render clock so the active line advances smoothly between engine emissions. */
const TICK_MS = 250

const { t } = useI18n()
const { showOnCaptionOverlay } = storeToRefs(useSettingsNowPlaying())

const context = useElectronEventaContext()
const getState = defineInvoke(context.value, nowPlayingGetStateInvokeEventa)

const state = ref<NowPlayingState>()
const receivedAt = ref(0)
const now = ref(Date.now())
let removeStateListener: (() => void) | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined

function setState(next: NowPlayingState) {
  state.value = next
  receivedAt.value = Date.now()
}

// Best-effort position between engine emissions: anchor + wall-clock elapsed.
const positionMs = computed(() => {
  const snapshot = state.value
  if (!snapshot || snapshot.status !== 'playing')
    return snapshot?.positionMs ?? 0
  return (snapshot.positionMs ?? 0) + (now.value - receivedAt.value)
})

const activeLineIndex = computed(() => {
  const snapshot = state.value
  if (!snapshot || snapshot.lyrics.length === 0)
    return -1
  return findCurrentLineIndex(snapshot.lyrics, positionMs.value)
})

const currentLine = computed(() => {
  const snapshot = state.value
  return activeLineIndex.value >= 0 ? snapshot?.lyrics[activeLineIndex.value] : undefined
})

const prevLine = computed(() => {
  const snapshot = state.value
  return activeLineIndex.value > 0 ? snapshot?.lyrics[activeLineIndex.value - 1] : undefined
})

const nextLine = computed(() => {
  const snapshot = state.value
  if (!snapshot || activeLineIndex.value < 0 || activeLineIndex.value >= snapshot.lyrics.length - 1)
    return undefined
  return snapshot.lyrics[activeLineIndex.value + 1]
})

const visible = computed(() =>
  Boolean(showOnCaptionOverlay.value)
  && Boolean(state.value?.track)
  && state.value?.status !== 'stopped',
)

const paused = computed(() => state.value?.status === 'paused')
const lyricsLoading = computed(() => Boolean(state.value?.lyricsLoading))
const hasLyrics = computed(() => Boolean(state.value?.lyrics.length))

onMounted(async () => {
  removeStateListener = context.value.on(nowPlayingStateChangedInvokeEventa, (event) => {
    if (event?.body)
      setState(event.body)
  })

  try {
    const initial = await getState()
    setState(initial)
  }
  catch {}

  tickTimer = setInterval(() => {
    now.value = Date.now()
  }, TICK_MS)
})

onUnmounted(() => {
  removeStateListener?.()
  removeStateListener = undefined
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = undefined
  }
})
</script>

<template>
  <div
    v-if="visible"
    :class="[
      'w-full flex flex-col gap-1 overflow-hidden',
      'rounded-md bg-neutral-950/72 px-2.5 py-2 shadow-md backdrop-blur-sm',
    ]"
  >
    <div :class="['flex min-w-0 items-center gap-1.5 text-xs text-neutral-300']">
      <span class="i-solar:music-notes-bold-duotone shrink-0 text-primary-300" />
      <span class="min-w-0 truncate text-neutral-100 font-semibold">
        {{ state?.track?.title }}
      </span>
      <span v-if="state?.track?.artist" class="min-w-0 truncate text-neutral-400">
        {{ state.track.artist }}
      </span>
      <span
        v-if="paused"
        class="ml-auto shrink-0 rounded bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-400 leading-none"
      >
        {{ t('tamagotchi.stage.now-playing.paused') }}
      </span>
    </div>

    <div v-if="lyricsLoading" :class="['text-xs text-neutral-400']">
      {{ t('tamagotchi.stage.now-playing.searching') }}
    </div>
    <div v-else-if="!hasLyrics" :class="['text-xs text-neutral-400']">
      {{ t('tamagotchi.stage.now-playing.no_lyrics') }}
    </div>
    <template v-else>
      <p v-if="prevLine" :class="['truncate text-xs text-neutral-400/80']">
        {{ prevLine.text }}
      </p>
      <Transition
        name="lyric-line"
        mode="out-in"
      >
        <p
          :key="activeLineIndex"
          :class="[
            'text-sm leading-5 font-semibold text-neutral-50',
            paused ? 'opacity-40' : '',
          ]"
        >
          {{ currentLine?.text }}
        </p>
      </Transition>
      <p v-if="nextLine" :class="['truncate text-xs text-neutral-400/80']">
        {{ nextLine.text }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.lyric-line-enter-active,
.lyric-line-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.lyric-line-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.lyric-line-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
