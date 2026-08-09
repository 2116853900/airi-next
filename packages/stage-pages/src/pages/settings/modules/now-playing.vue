<script setup lang="ts">
import type { NowPlayingState } from '@proj-airi/stage-shared/now-playing'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import {
  nowPlayingGetStateInvokeEventa,
  nowPlayingRefreshLyricsInvokeEventa,
  nowPlayingSetEnabledInvokeEventa,
  nowPlayingStateChangedInvokeEventa,
} from '@proj-airi/stage-shared/now-playing'
import { useSettingsNowPlaying } from '@proj-airi/stage-ui/stores/settings'
import { Button, FieldCheckbox, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const settings = useSettingsNowPlaying()
const { enabled, autoBeatSync, lyricsSource, showOnCaptionOverlay } = storeToRefs(settings)

const isDesktop = isStageTamagotchi()

const lyricsSourceOptions = computed(() => [
  {
    label: t('settings.pages.modules.now_playing.sections.lyrics_source.options.lrclib'),
    value: 'lrclib' as const,
  },
  {
    label: t('settings.pages.modules.now_playing.sections.lyrics_source.options.lrclib_netease'),
    value: 'lrclib-netease' as const,
  },
])

const state = ref<NowPlayingState>()
let removeStateListener: (() => void) | undefined
let setEnabled: ((value: boolean) => Promise<void>) | undefined
let refreshLyrics: (() => Promise<void>) | undefined

const statusText = computed(() => {
  const snapshot = state.value
  if (!snapshot?.track)
    return t('settings.pages.modules.now_playing.sections.status.no_player')
  const trackLabel = snapshot.track.artist
    ? `${snapshot.track.title} · ${snapshot.track.artist}`
    : snapshot.track.title
  const sourceLabel = snapshot.lyricsSource === 'netease'
    ? t('settings.pages.modules.now_playing.sections.status.source_netease')
    : snapshot.lyricsSource === 'lrclib'
      ? t('settings.pages.modules.now_playing.sections.status.source_lrclib')
      : t('settings.pages.modules.now_playing.sections.status.source_none')
  return `${trackLabel} — ${snapshot.status} (${sourceLabel})`
})

const activeLineText = computed(() => {
  const snapshot = state.value
  if (!snapshot || snapshot.activeLineIndex < 0)
    return undefined
  return snapshot.lyrics[snapshot.activeLineIndex]?.text
})

function getElectronIpcRenderer() {
  return (window as Window & {
    electron?: { ipcRenderer?: unknown }
  }).electron?.ipcRenderer
}

async function syncEnabled(value: boolean) {
  enabled.value = value
  if (isDesktop && setEnabled)
    await setEnabled(value)
}

onMounted(async () => {
  if (!isDesktop)
    return

  const ipcRenderer = getElectronIpcRenderer()
  if (!ipcRenderer)
    return

  const { context } = createContext(ipcRenderer as Parameters<typeof createContext>[0])
  const getState = defineInvoke(context, nowPlayingGetStateInvokeEventa)
  setEnabled = defineInvoke(context, nowPlayingSetEnabledInvokeEventa)
  refreshLyrics = defineInvoke(context, nowPlayingRefreshLyricsInvokeEventa)
  removeStateListener = context.on(nowPlayingStateChangedInvokeEventa, (event) => {
    if (event?.body)
      state.value = event.body
  })

  try {
    state.value = await getState()
  }
  catch {}
})

onUnmounted(() => {
  removeStateListener?.()
  removeStateListener = undefined
})
</script>

<template>
  <div flex="~ col gap-6">
    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
          {{ t('settings.pages.modules.now_playing.sections.behavior.title') }}
        </h2>
      </div>

      <FieldCheckbox
        v-model="enabled"
        :label="t('settings.pages.modules.now_playing.sections.behavior.enabled.label')"
        :description="t('settings.pages.modules.now_playing.sections.behavior.enabled.description')"
        @update:model-value="syncEnabled"
      />

      <FieldCheckbox
        v-model="autoBeatSync"
        :label="t('settings.pages.modules.now_playing.sections.behavior.auto_beat_sync.label')"
        :description="t('settings.pages.modules.now_playing.sections.behavior.auto_beat_sync.description')"
      />
    </div>

    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
          {{ t('settings.pages.modules.now_playing.sections.lyrics_source.title') }}
        </h2>
        <div text="neutral-400 dark:neutral-400">
          <span>{{ t('settings.pages.modules.now_playing.sections.lyrics_source.description') }}</span>
        </div>
      </div>

      <SelectTab v-model="lyricsSource" :options="lyricsSourceOptions" />

      <FieldCheckbox
        v-model="showOnCaptionOverlay"
        :label="t('settings.pages.modules.now_playing.sections.lyrics_source.show_on_overlay.label')"
      />
    </div>

    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
          {{ t('settings.pages.modules.now_playing.sections.status.title') }}
        </h2>
      </div>

      <template v-if="isDesktop">
        <div text="neutral-400 dark:neutral-400">
          <span>{{ statusText }}</span>
        </div>
        <div v-if="activeLineText" text="neutral-100 dark:neutral-100">
          <span>{{ activeLineText }}</span>
        </div>
        <div>
          <Button :disabled="!state?.track" @click="refreshLyrics?.()">
            {{ t('settings.pages.modules.now_playing.sections.status.refresh') }}
          </Button>
        </div>
      </template>

      <div v-else text="neutral-400 dark:neutral-400">
        <span>{{ t('settings.pages.modules.now_playing.sections.status.desktop_only') }}</span>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.now_playing.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
