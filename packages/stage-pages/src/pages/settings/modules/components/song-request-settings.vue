<script setup lang="ts">
import type { SongRequestPlaybackItem, SongRequestPlaybackState } from '@proj-airi/stage-shared/song-request'

import { defineInvoke } from '@moeru/eventa'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import {
  createEmptySongRequestPlaybackState,
  getSongRequestBusContext,
  parseSongRequestCommand,
  songRequestGetPlaybackStateInvokeEventa,
  songRequestPlaybackStateChangedEventa,
  songRequestSubmitTestInvokeEventa,
} from '@proj-airi/stage-shared/song-request'
import { useSettingsLiveChat } from '@proj-airi/stage-ui/stores/settings'
import { Button, FieldCheckbox, FieldInput, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import SongRequestAccountLogin from './song-request-account-login.vue'

const { t } = useI18n()
const isDesktop = isStageTamagotchi()
const {
  songRequestEnabled,
  songRequestQueueLimit,
  songRequestUserCooldownMs,
  songRequestVolume,
} = storeToRefs(useSettingsLiveChat())

const testQuery = shallowRef('')
const isSubmitting = shallowRef(false)
const playbackState = shallowRef<SongRequestPlaybackState>(createEmptySongRequestPlaybackState())
let removeStateListener: (() => void) | undefined

function itemLabel(item: SongRequestPlaybackItem | null): string {
  if (!item)
    return t('settings.pages.modules.live_chat.sections.song_request.status.empty')
  if (item.track)
    return `${item.track.title} · ${item.track.artist}`
  return item.query
}

const currentLabel = computed(() => itemLabel(playbackState.value.current))
const nextLabel = computed(() => itemLabel(playbackState.value.next))
const currentPhaseLabel = computed(() => {
  const phase = playbackState.value.current?.phase
  if (!phase)
    return undefined
  return t(`settings.pages.modules.live_chat.sections.song_request.status.phase.${phase}`)
})

async function submitTestRequest(): Promise<void> {
  if (!isDesktop || isSubmitting.value)
    return

  const command = parseSongRequestCommand(`点歌 ${testQuery.value}`)
  if (!command) {
    toast.error(t('settings.pages.modules.live_chat.sections.song_request.test.invalid'))
    return
  }

  isSubmitting.value = true
  try {
    const submit = defineInvoke(getSongRequestBusContext(), songRequestSubmitTestInvokeEventa)
    const result = await submit({ query: command.query })
    if (result.ok) {
      testQuery.value = ''
      toast.success(t('settings.pages.modules.live_chat.sections.song_request.messages.accepted', {
        position: result.position,
        query: command.query,
      }))
      return
    }

    toast.error(t(`settings.pages.modules.live_chat.sections.song_request.test.${result.reason}`))
  }
  catch {
    toast.error(t('settings.pages.modules.live_chat.sections.song_request.test.unavailable'))
  }
  finally {
    isSubmitting.value = false
  }
}

onMounted(async () => {
  if (!isDesktop)
    return

  const context = getSongRequestBusContext()
  const getPlaybackState = defineInvoke(context, songRequestGetPlaybackStateInvokeEventa)
  removeStateListener = context.on(songRequestPlaybackStateChangedEventa, (event) => {
    if (event?.body)
      playbackState.value = event.body
  })

  try {
    playbackState.value = await getPlaybackState()
  }
  catch {
    playbackState.value = createEmptySongRequestPlaybackState()
  }
})

onUnmounted(() => {
  removeStateListener?.()
  removeStateListener = undefined
})
</script>

<template>
  <section
    v-if="isDesktop"
    :class="[
      'flex flex-col gap-4 p-4',
      'rounded-lg bg-neutral-100 dark:bg-[rgba(0,0,0,0.3)]',
    ]"
  >
    <div>
      <h2 :class="['text-lg text-neutral-500 md:text-2xl dark:text-neutral-500']">
        {{ t('settings.pages.modules.live_chat.sections.song_request.title') }}
      </h2>
      <p :class="['text-neutral-400 dark:text-neutral-400']">
        {{ t('settings.pages.modules.live_chat.sections.song_request.description') }}
      </p>
    </div>

    <FieldCheckbox
      v-model="songRequestEnabled"
      :label="t('settings.pages.modules.live_chat.sections.song_request.enabled.label')"
      :description="t('settings.pages.modules.live_chat.sections.song_request.enabled.description')"
    />

    <template v-if="songRequestEnabled">
      <FieldRange
        v-model="songRequestVolume"
        :label="t('settings.pages.modules.live_chat.sections.song_request.volume.label')"
        :description="t('settings.pages.modules.live_chat.sections.song_request.volume.description')"
        :min="0"
        :max="1"
        :step="0.05"
        :format-value="value => `${(value * 100).toFixed(0)}%`"
      />

      <FieldRange
        v-model="songRequestQueueLimit"
        :label="t('settings.pages.modules.live_chat.sections.song_request.queue_limit.label')"
        :description="t('settings.pages.modules.live_chat.sections.song_request.queue_limit.description')"
        :min="1"
        :max="50"
        :step="1"
        :format-value="value => value.toFixed(0)"
      />

      <FieldRange
        v-model="songRequestUserCooldownMs"
        :label="t('settings.pages.modules.live_chat.sections.song_request.user_cooldown.label')"
        :description="t('settings.pages.modules.live_chat.sections.song_request.user_cooldown.description')"
        :min="0"
        :max="120000"
        :step="1000"
        :format-value="value => `${(value / 1000).toFixed(0)} s`"
      />

      <div :class="['grid grid-cols-1 gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800']">
        <div :class="['grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3']">
          <span :class="['i-solar:play-circle-bold-duotone h-5 w-5 text-primary-500']" />
          <div :class="['min-w-0']">
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.pages.modules.live_chat.sections.song_request.status.current') }}
            </div>
            <div :class="['truncate text-sm text-neutral-800 font-medium dark:text-neutral-100']">
              {{ currentLabel }}
            </div>
          </div>
          <span v-if="currentPhaseLabel" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ currentPhaseLabel }}
          </span>
        </div>

        <div :class="['grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3']">
          <span :class="['i-solar:skip-next-bold-duotone h-5 w-5 text-neutral-400']" />
          <div :class="['min-w-0']">
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.pages.modules.live_chat.sections.song_request.status.next') }}
            </div>
            <div :class="['truncate text-sm text-neutral-700 dark:text-neutral-200']">
              {{ nextLabel }}
            </div>
          </div>
        </div>
      </div>

      <div :class="['border-t border-neutral-200 pt-4 dark:border-neutral-800']">
        <div :class="['mb-3']">
          <div :class="['text-sm text-neutral-800 font-medium dark:text-neutral-100']">
            {{ t('settings.pages.modules.live_chat.sections.song_request.test.title') }}
          </div>
          <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.modules.live_chat.sections.song_request.test.description') }}
          </div>
        </div>
        <div :class="['grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3']">
          <FieldInput
            v-model="testQuery"
            :label="t('settings.pages.modules.live_chat.sections.song_request.test.label')"
            :placeholder="t('settings.pages.modules.live_chat.sections.song_request.test.placeholder')"
            @keyup.enter="submitTestRequest"
          />
          <Button
            icon="i-solar:music-note-4-bold-duotone"
            color="primary"
            variant="primary"
            :loading="isSubmitting"
            :disabled="!testQuery.trim()"
            @click="submitTestRequest"
          >
            {{ t('settings.pages.modules.live_chat.sections.song_request.test.submit') }}
          </Button>
        </div>
      </div>

      <SongRequestAccountLogin />
    </template>
  </section>

  <div v-else :class="['text-neutral-400 dark:text-neutral-400']">
    {{ t('settings.pages.modules.live_chat.sections.song_request.desktop_only') }}
  </div>
</template>
