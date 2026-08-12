<script setup lang="ts">
import type { WatchAlongSceneChangeSensitivity, WatchAlongSummarizerMode } from '@proj-airi/stage-ui/stores/modules/watch-along'
import type { SourcesOptions } from 'electron'

import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useWatchAlongSessionStore, useWatchAlongStore } from '@proj-airi/stage-ui/stores/modules/watch-along'
import { Button, FieldCheckbox, FieldInput, FieldRange, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import WithScreenCapture from '../../../components/WithScreenCapture.vue'

import { useVisionScreenCapture } from '../../../composables/use-vision-screen-capture'

type SourceCategory = 'applications' | 'displays'

const { t } = useI18n()
const router = useRouter()

const settings = useWatchAlongStore()
const session = useWatchAlongSessionStore()
const visionStore = useVisionStore()
const {
  enabled,
  sourceId,
  sourceName,
  autoStartEnabled,
  autoStartKeywords,
  captureIntervalMs,
  periodicSummaryEnabled,
  summaryIntervalMs,
  sceneChangeCommentsEnabled,
  sceneChangeSensitivity,
  commentCooldownMs,
  summarizerMode,
} = storeToRefs(settings)
const { status, lastError, activeSourceName, observationCount, commentCount, lastCommentAt } = storeToRefs(session)
const { activeModel: visionModel, configured: visionConfigured } = storeToRefs(visionStore)

const sourcesOptions = ref<SourcesOptions>({
  types: ['screen', 'window'],
  fetchWindowIcons: true,
})

const {
  sources,
  isRefetching,
  hasFetchedOnce,
  refetchSources,
  cleanup,
} = useVisionScreenCapture(sourcesOptions)

const sourceCategory = ref<SourceCategory>('displays')

const summarizerOptions = computed(() => [
  {
    label: t('settings.pages.modules.watch_along.sections.behavior.summarizer_mode.options.vision'),
    value: 'vision' as WatchAlongSummarizerMode,
  },
  {
    label: t('settings.pages.modules.watch_along.sections.behavior.summarizer_mode.options.consciousness'),
    value: 'consciousness' as WatchAlongSummarizerMode,
  },
])

const sensitivityOptions = computed(() => [
  {
    label: t('settings.pages.modules.watch_along.sections.pace.scene_change_sensitivity.options.low'),
    value: 'low' as WatchAlongSceneChangeSensitivity,
  },
  {
    label: t('settings.pages.modules.watch_along.sections.pace.scene_change_sensitivity.options.medium'),
    value: 'medium' as WatchAlongSceneChangeSensitivity,
  },
  {
    label: t('settings.pages.modules.watch_along.sections.pace.scene_change_sensitivity.options.high'),
    value: 'high' as WatchAlongSceneChangeSensitivity,
  },
])

const isDisplaySource = (source: { id: string }) => source.id.startsWith('screen:')
const isWindowSource = (source: { id: string }) => source.id.startsWith('window:')

const filteredSources = computed(() => {
  if (sourceCategory.value === 'applications')
    return sources.value.filter(isWindowSource)
  return sources.value.filter(isDisplaySource)
})

const categoryOptions = computed(() => [
  {
    label: `${t('settings.pages.modules.watch_along.sections.source.categories.displays')} (${sources.value.filter(isDisplaySource).length})`,
    value: 'displays' as SourceCategory,
    icon: 'i-solar:screencast-2-line-duotone',
  },
  {
    label: `${t('settings.pages.modules.watch_along.sections.source.categories.applications')} (${sources.value.filter(isWindowSource).length})`,
    value: 'applications' as SourceCategory,
    icon: 'i-solar:window-frame-line-duotone',
  },
])

const isInitialLoading = computed(() => !hasFetchedOnce.value && isRefetching.value)

const statusLabel = computed(() => t(`settings.pages.modules.watch_along.sections.status.states.${status.value}`))
const lastCommentTime = computed(() => {
  if (!lastCommentAt.value)
    return null
  return new Date(lastCommentAt.value).toLocaleTimeString()
})

function selectSource(source: { id: string, name: string }) {
  sourceId.value = source.id
  sourceName.value = source.name
}

function handlePermissionGranted() {
  void refetchSources()
}

onBeforeUnmount(() => {
  cleanup()
})
</script>

<template>
  <div :class="['flex', 'flex-col', 'gap-6']">
    <div
      :class="[
        'rounded-xl', 'p-4',
        'flex', 'flex-col', 'gap-4',
        'bg-neutral-100', 'dark:bg-[rgba(0,0,0,0.3)]',
      ]"
    >
      <div>
        <h2 :class="['text-lg', 'md:text-2xl', 'text-neutral-500', 'dark:text-neutral-500']">
          {{ t('settings.pages.modules.watch_along.sections.behavior.title') }}
        </h2>
      </div>

      <FieldCheckbox
        v-model="enabled"
        :label="t('settings.pages.modules.watch_along.sections.behavior.enabled.label')"
        :description="t('settings.pages.modules.watch_along.sections.behavior.enabled.description')"
      />

      <FieldCheckbox
        v-model="autoStartEnabled"
        :label="t('settings.pages.modules.watch_along.sections.behavior.auto_start.label')"
        :description="t('settings.pages.modules.watch_along.sections.behavior.auto_start.description')"
      />

      <FieldInput
        v-if="autoStartEnabled"
        v-model="autoStartKeywords"
        :label="t('settings.pages.modules.watch_along.sections.behavior.auto_start_keywords.label')"
        :description="t('settings.pages.modules.watch_along.sections.behavior.auto_start_keywords.description')"
        :placeholder="t('settings.pages.modules.watch_along.sections.behavior.auto_start_keywords.placeholder')"
      />

      <div :class="['flex', 'flex-col', 'gap-2']">
        <div>
          <div :class="['text-sm', 'font-medium']">
            {{ t('settings.pages.modules.watch_along.sections.behavior.summarizer_mode.label') }}
          </div>
          <div :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.pages.modules.watch_along.sections.behavior.summarizer_mode.description') }}
          </div>
        </div>
        <SelectTab v-model="summarizerMode" :options="summarizerOptions" />
      </div>

      <FieldRange
        v-model="commentCooldownMs"
        :label="t('settings.pages.modules.watch_along.sections.behavior.comment_cooldown.label')"
        :description="t('settings.pages.modules.watch_along.sections.behavior.comment_cooldown.description')"
        :min="15000"
        :max="300000"
        :step="15000"
        :format-value="value => `${Math.round(value / 1000)}s`"
      />
    </div>

    <div
      :class="[
        'rounded-xl', 'p-4',
        'flex', 'flex-col', 'gap-4',
        'bg-neutral-100', 'dark:bg-[rgba(0,0,0,0.3)]',
      ]"
    >
      <div>
        <h2 :class="['text-lg', 'md:text-2xl', 'text-neutral-500', 'dark:text-neutral-500']">
          {{ t('settings.pages.modules.watch_along.sections.pace.title') }}
        </h2>
      </div>

      <FieldRange
        v-model="captureIntervalMs"
        :label="t('settings.pages.modules.watch_along.sections.pace.capture_interval.label')"
        :description="t('settings.pages.modules.watch_along.sections.pace.capture_interval.description')"
        :min="2000"
        :max="30000"
        :step="1000"
        :format-value="value => `${Math.round(value / 1000)}s`"
      />

      <FieldCheckbox
        v-model="periodicSummaryEnabled"
        :label="t('settings.pages.modules.watch_along.sections.pace.periodic_summary.label')"
        :description="t('settings.pages.modules.watch_along.sections.pace.periodic_summary.description')"
      />

      <FieldRange
        v-if="periodicSummaryEnabled"
        v-model="summaryIntervalMs"
        :label="t('settings.pages.modules.watch_along.sections.pace.summary_interval.label')"
        :description="t('settings.pages.modules.watch_along.sections.pace.summary_interval.description')"
        :min="60000"
        :max="900000"
        :step="60000"
        :format-value="value => `${Math.round(value / 60000)}min`"
      />

      <FieldCheckbox
        v-model="sceneChangeCommentsEnabled"
        :label="t('settings.pages.modules.watch_along.sections.pace.scene_change.label')"
        :description="t('settings.pages.modules.watch_along.sections.pace.scene_change.description')"
      />

      <div v-if="sceneChangeCommentsEnabled" :class="['flex', 'flex-col', 'gap-2']">
        <div>
          <div :class="['text-sm', 'font-medium']">
            {{ t('settings.pages.modules.watch_along.sections.pace.scene_change_sensitivity.label') }}
          </div>
          <div :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.pages.modules.watch_along.sections.pace.scene_change_sensitivity.description') }}
          </div>
        </div>
        <SelectTab v-model="sceneChangeSensitivity" :options="sensitivityOptions" />
      </div>
    </div>

    <div
      :class="[
        'rounded-xl', 'p-4',
        'flex', 'flex-col', 'gap-4',
        'bg-neutral-100', 'dark:bg-[rgba(0,0,0,0.3)]',
      ]"
    >
      <div>
        <h2 :class="['text-lg', 'md:text-2xl', 'text-neutral-500', 'dark:text-neutral-500']">
          {{ t('settings.pages.modules.watch_along.sections.model.title') }}
        </h2>
        <div :class="['text-neutral-400', 'dark:text-neutral-400']">
          {{ t('settings.pages.modules.watch_along.sections.model.description') }}
        </div>
      </div>

      <div :class="['flex', 'items-center', 'justify-between', 'gap-3']">
        <div
          v-if="visionConfigured"
          :class="['text-sm', 'text-neutral-600', 'dark:text-neutral-300']"
        >
          {{ t('settings.pages.modules.watch_along.sections.model.configured', { model: visionModel }) }}
        </div>
        <div
          v-else
          :class="['text-sm', 'text-amber-600', 'dark:text-amber-400']"
        >
          {{ t('settings.pages.modules.watch_along.sections.model.not_configured') }}
        </div>
        <Button @click="router.push('/settings/modules/vision')">
          {{ t('settings.pages.modules.watch_along.sections.model.configure') }}
        </Button>
      </div>
    </div>

    <WithScreenCapture
      :sources-options="sourcesOptions"
      @permission-granted="handlePermissionGranted()"
    >
      <template #default="{ hasPermissions, requestPermission }">
        <div
          :class="[
            'rounded-xl', 'p-4',
            'flex', 'flex-col', 'gap-4',
            'bg-neutral-100', 'dark:bg-[rgba(0,0,0,0.3)]',
          ]"
        >
          <div>
            <h2 :class="['text-lg', 'md:text-2xl', 'text-neutral-500', 'dark:text-neutral-500']">
              {{ t('settings.pages.modules.watch_along.sections.source.title') }}
            </h2>
            <div :class="['text-neutral-400', 'dark:text-neutral-400']">
              {{ t('settings.pages.modules.watch_along.sections.source.description') }}
            </div>
          </div>

          <template v-if="hasPermissions">
            <div :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
              {{ sourceName
                ? t('settings.pages.modules.watch_along.sections.source.selected', { name: sourceName })
                : t('settings.pages.modules.watch_along.sections.source.none_selected') }}
            </div>

            <div :class="['flex', 'items-center', 'gap-3']">
              <SelectTab
                v-model="sourceCategory"
                size="sm"
                :options="categoryOptions"
                :class="['flex-1']"
              />
              <Button
                icon="i-solar:refresh-line-duotone"
                size="sm"
                :disabled="isRefetching"
                @click="refetchSources()"
              >
                {{ t('settings.pages.modules.watch_along.sections.source.refetch') }}
              </Button>
            </div>

            <div
              v-if="isInitialLoading"
              :class="[
                'flex', 'items-center', 'justify-center', 'gap-2',
                'rounded-xl', 'px-4', 'py-10',
                'border-2', 'border-dashed', 'border-neutral-200/70', 'dark:border-neutral-800/40',
                'text-sm', 'text-neutral-500',
              ]"
            >
              <div :class="['i-svg-spinners:ring-resize', 'text-lg']" />
              <span>{{ t('settings.pages.modules.watch_along.sections.source.loading') }}</span>
            </div>

            <div
              v-else-if="filteredSources.length > 0"
              :class="['grid', 'gap-3', 'grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3']"
            >
              <button
                v-for="source in filteredSources"
                :key="source.id"
                type="button"
                :class="[
                  'flex', 'flex-col', 'gap-2',
                  'w-full', 'rounded-xl', 'p-3', 'text-left',
                  'border', 'bg-white/60', 'dark:bg-neutral-900/40',
                  'transition', 'duration-200',
                  sourceId === source.id
                    ? 'border-primary-400/70 shadow-sm'
                    : 'border-transparent hover:border-neutral-200 dark:hover:border-neutral-700',
                ]"
                @click="selectSource(source)"
              >
                <div
                  :class="[
                    'relative', 'aspect-video', 'w-full',
                    'overflow-hidden', 'rounded-lg',
                    'bg-neutral-200/60', 'dark:bg-neutral-800',
                  ]"
                >
                  <img
                    v-if="source.thumbnailURL"
                    :src="source.thumbnailURL"
                    alt="Source preview"
                    :class="['h-full', 'w-full', 'object-contain']"
                  >
                  <div
                    v-else
                    :class="[
                      'absolute', 'inset-0',
                      'flex', 'items-center', 'justify-center',
                      'text-2xl', 'text-neutral-400', 'i-solar:screen-share-line-duotone',
                    ]"
                  />
                </div>
                <div :class="['flex', 'items-center', 'gap-2']">
                  <div :class="['h-5', 'w-5']">
                    <img v-if="source.appIconURL" :src="source.appIconURL" alt="Source icon" :class="['h-full', 'w-full']">
                    <div v-else :class="['i-solar:window-frame-line-duotone', 'h-full', 'w-full']" />
                  </div>
                  <div :class="['text-sm', 'text-neutral-700', 'dark:text-neutral-200', 'line-clamp-1']">
                    {{ source.name }}
                  </div>
                </div>
              </button>
            </div>

            <div
              v-else
              :class="[
                'flex', 'flex-col', 'items-center', 'justify-center', 'gap-2',
                'rounded-xl', 'px-4', 'py-10',
                'border-2', 'border-dashed', 'border-neutral-200/70', 'dark:border-neutral-800/40',
                'text-sm', 'text-neutral-500',
              ]"
            >
              <div :class="['i-solar:shield-warning-line-duotone', 'text-2xl']" />
              <div>{{ t('settings.pages.modules.watch_along.sections.source.empty') }}</div>
            </div>
          </template>

          <div
            v-else
            :class="['flex', 'flex-col', 'items-start', 'gap-3']"
          >
            <div :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
              {{ t('settings.pages.modules.watch_along.sections.source.permission_required') }}
            </div>
            <Button @click="requestPermission()">
              {{ t('settings.pages.modules.watch_along.sections.source.open_preferences') }}
            </Button>
          </div>
        </div>
      </template>
    </WithScreenCapture>

    <div
      :class="[
        'rounded-xl', 'p-4',
        'flex', 'flex-col', 'gap-4',
        'bg-neutral-100', 'dark:bg-[rgba(0,0,0,0.3)]',
      ]"
    >
      <div>
        <h2 :class="['text-lg', 'md:text-2xl', 'text-neutral-500', 'dark:text-neutral-500']">
          {{ t('settings.pages.modules.watch_along.sections.status.title') }}
        </h2>
      </div>

      <div :class="['flex', 'flex-col', 'gap-1', 'text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
        <div>{{ statusLabel }}</div>
        <div v-if="status === 'watching' && activeSourceName">
          {{ t('settings.pages.modules.watch_along.sections.status.watching_source', { name: activeSourceName }) }}
        </div>
        <div v-if="status !== 'idle'">
          {{ t('settings.pages.modules.watch_along.sections.status.observations', { count: observationCount }) }}
          ·
          {{ t('settings.pages.modules.watch_along.sections.status.comments', { count: commentCount }) }}
        </div>
        <div v-if="lastCommentTime">
          {{ t('settings.pages.modules.watch_along.sections.status.last_comment_at', { time: lastCommentTime }) }}
        </div>
        <div v-if="lastError" :class="['text-amber-600', 'dark:text-amber-400']">
          {{ lastError }}
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.watch_along.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
