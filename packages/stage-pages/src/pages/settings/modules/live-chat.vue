<script setup lang="ts">
import { useSettingsLiveChat } from '@proj-airi/stage-ui/stores/settings'
import { FieldCheckbox, FieldInput, FieldRange, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const settings = useSettingsLiveChat()
const {
  showOnCaptionOverlay,
  maxItems,
  ttlMs,
  fontSize,
  opacity,
  bgOpacity,
  textColor,
  showLevel,
  msgBgColor,
  msgBgOpacity,
  levelColors,
  dedupeEnabled,
  dedupeWindowMs,
  dedupeMaxRepeats,
  aiReplyEnabled,
  aiReplyTrigger,
  aiReplyTriggerKeywords,
  aiReplyCooldownMs,
  aiReplyIncludeSender,
  aiReplyMaxLength,
} = storeToRefs(settings)

const aiReplyTriggerOptions = computed(() => [
  {
    label: t('settings.pages.modules.live_chat.sections.ai_reply.trigger.options.mention'),
    value: 'mention' as const,
  },
  {
    label: t('settings.pages.modules.live_chat.sections.ai_reply.trigger.options.all'),
    value: 'all' as const,
  },
])

/** Level color entries for the UI: { level, color }[] */
const levelColorEntries = computed({
  get() {
    try {
      const map = JSON.parse(levelColors.value)
      return Object.entries(map).map(([level, color]) => ({ level, color: color as string }))
    }
    catch {
      return []
    }
  },
  set(entries: { level: string, color: string }[]) {
    const map: Record<string, string> = {}
    for (const entry of entries) {
      if (entry.level.trim())
        map[entry.level.trim()] = entry.color
    }
    levelColors.value = JSON.stringify(map)
  },
})

function addLevelColorEntry() {
  levelColorEntries.value = [...levelColorEntries.value, { level: '', color: '#f5f5f5' }]
}

function removeLevelColorEntry(index: number) {
  const entries = [...levelColorEntries.value]
  entries.splice(index, 1)
  levelColorEntries.value = entries
}
</script>

<template>
  <div flex="~ col gap-6">
    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
          {{ t('settings.pages.modules.live_chat.sections.display.title') }}
        </h2>
        <div text="neutral-400 dark:neutral-400">
          <span>{{ t('settings.pages.modules.live_chat.sections.display.description') }}</span>
        </div>
      </div>

      <FieldCheckbox
        v-model="showOnCaptionOverlay"
        :label="t('settings.pages.modules.live_chat.sections.display.show_on_overlay.label')"
        :description="t('settings.pages.modules.live_chat.sections.display.show_on_overlay.description')"
      />

      <FieldCheckbox
        v-model="dedupeEnabled"
        :label="t('settings.pages.modules.live_chat.sections.display.dedupe.enabled.label')"
        :description="t('settings.pages.modules.live_chat.sections.display.dedupe.enabled.description')"
      />

      <template v-if="dedupeEnabled">
        <FieldRange
          v-model="dedupeWindowMs"
          :label="t('settings.pages.modules.live_chat.sections.display.dedupe.window.label')"
          :description="t('settings.pages.modules.live_chat.sections.display.dedupe.window.description')"
          :min="5000"
          :max="120000"
          :step="1000"
          :format-value="value => `${(value / 1000).toFixed(0)} s`"
        />

        <FieldRange
          v-model="dedupeMaxRepeats"
          :label="t('settings.pages.modules.live_chat.sections.display.dedupe.max_repeats.label')"
          :description="t('settings.pages.modules.live_chat.sections.display.dedupe.max_repeats.description')"
          :min="1"
          :max="10"
          :step="1"
          :format-value="value => `${value.toFixed(0)}×`"
        />
      </template>

      <FieldRange
        v-model="maxItems"
        :label="t('settings.pages.modules.live_chat.sections.display.max_items.label')"
        :description="t('settings.pages.modules.live_chat.sections.display.max_items.description')"
        :min="1"
        :max="10"
        :step="1"
        :format-value="value => String(value)"
      />

      <FieldRange
        v-model="ttlMs"
        :label="t('settings.pages.modules.live_chat.sections.display.ttl.label')"
        :description="t('settings.pages.modules.live_chat.sections.display.ttl.description')"
        :min="3000"
        :max="60000"
        :step="1000"
        :format-value="value => `${(value / 1000).toFixed(0)} s`"
      />

      <FieldRange
        v-model="fontSize"
        :label="t('settings.pages.modules.live_chat.sections.display.font_size.label')"
        :min="12"
        :max="24"
        :step="1"
        :format-value="value => `${value.toFixed(0)} px`"
      />

      <FieldRange
        v-model="opacity"
        :label="t('settings.pages.modules.live_chat.sections.display.opacity.label')"
        :min="0.2"
        :max="1"
        :step="0.01"
        :format-value="value => `${(value * 100).toFixed(0)}%`"
      />
    </div>

    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
          {{ t('settings.pages.modules.live_chat.sections.theme.title') }}
        </h2>
        <div text="neutral-400 dark:neutral-400">
          <span>{{ t('settings.pages.modules.live_chat.sections.theme.description') }}</span>
        </div>
      </div>

      <FieldRange
        v-model="bgOpacity"
        :label="t('settings.pages.modules.live_chat.sections.theme.bg_opacity.label')"
        :description="t('settings.pages.modules.live_chat.sections.theme.bg_opacity.description')"
        :min="0"
        :max="1"
        :step="0.05"
        :format-value="value => `${(value * 100).toFixed(0)}%`"
      />

      <div flex="~ row gap-3 items-center">
        <label class="text-sm text-neutral-400">{{ t('settings.pages.modules.live_chat.sections.theme.text_color.label') }}</label>
        <input
          v-model="textColor"
          type="color"
          class="h-8 w-12 cursor-pointer border-0 rounded bg-transparent p-0"
        >
      </div>

      <div flex="~ row gap-3 items-center">
        <label class="text-sm text-neutral-400">{{ t('settings.pages.modules.live_chat.sections.theme.msg_bg_color.label') }}</label>
        <input
          v-model="msgBgColor"
          type="color"
          class="h-8 w-12 cursor-pointer border-0 rounded bg-transparent p-0"
        >
      </div>

      <FieldRange
        v-model="msgBgOpacity"
        :label="t('settings.pages.modules.live_chat.sections.theme.msg_bg_opacity.label')"
        :description="t('settings.pages.modules.live_chat.sections.theme.msg_bg_opacity.description')"
        :min="0"
        :max="1"
        :step="0.05"
        :format-value="value => `${(value * 100).toFixed(0)}%`"
      />

      <FieldCheckbox
        v-model="showLevel"
        :label="t('settings.pages.modules.live_chat.sections.theme.show_level.label')"
        :description="t('settings.pages.modules.live_chat.sections.theme.show_level.description')"
      />

      <!-- Level-based color mapping -->
      <div>
        <div class="mb-2 text-sm text-neutral-400">
          {{ t('settings.pages.modules.live_chat.sections.theme.level_colors.title') }}
        </div>
        <div class="mb-2 text-xs text-neutral-500">
          {{ t('settings.pages.modules.live_chat.sections.theme.level_colors.description') }}
        </div>
        <div
          v-for="(entry, index) in levelColorEntries"
          :key="index"
          flex="~ row gap-2 items-center"
          class="mb-2"
        >
          <input
            v-model="entry.level"
            type="text"
            class="w-16 border border-neutral-600 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
            :placeholder="t('settings.pages.modules.live_chat.sections.theme.level_colors.level_placeholder')"
          >
          <input
            v-model="entry.color"
            type="color"
            class="h-8 w-12 cursor-pointer border-0 rounded bg-transparent p-0"
          >
          <button
            class="cursor-pointer rounded px-2 py-1 text-xs text-red-400 hover:bg-red-400/10"
            @click="removeLevelColorEntry(index)"
          >
            {{ t('common.remove') }}
          </button>
        </div>
        <button
          class="cursor-pointer rounded bg-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-600"
          @click="addLevelColorEntry"
        >
          {{ t('settings.pages.modules.live_chat.sections.theme.level_colors.add') }}
        </button>
      </div>
    </div>

    <div bg="neutral-100 dark:[rgba(0,0,0,0.3)]" rounded-xl p-4 flex="~ col gap-4">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-500">
          {{ t('settings.pages.modules.live_chat.sections.ai_reply.title') }}
        </h2>
        <div text="neutral-400 dark:neutral-400">
          <span>{{ t('settings.pages.modules.live_chat.sections.ai_reply.description') }}</span>
        </div>
      </div>

      <FieldCheckbox
        v-model="aiReplyEnabled"
        :label="t('settings.pages.modules.live_chat.sections.ai_reply.enabled.label')"
        :description="t('settings.pages.modules.live_chat.sections.ai_reply.enabled.description')"
      />

      <SelectTab v-model="aiReplyTrigger" :options="aiReplyTriggerOptions" />

      <FieldInput
        v-model="aiReplyTriggerKeywords"
        :label="t('settings.pages.modules.live_chat.sections.ai_reply.trigger_keywords.label')"
        :description="t('settings.pages.modules.live_chat.sections.ai_reply.trigger_keywords.description')"
        :placeholder="t('settings.pages.modules.live_chat.sections.ai_reply.trigger_keywords.placeholder')"
      />

      <FieldRange
        v-model="aiReplyCooldownMs"
        :label="t('settings.pages.modules.live_chat.sections.ai_reply.cooldown.label')"
        :description="t('settings.pages.modules.live_chat.sections.ai_reply.cooldown.description')"
        :min="5000"
        :max="120000"
        :step="1000"
        :format-value="value => `${(value / 1000).toFixed(0)} s`"
      />

      <FieldCheckbox
        v-model="aiReplyIncludeSender"
        :label="t('settings.pages.modules.live_chat.sections.ai_reply.include_sender.label')"
        :description="t('settings.pages.modules.live_chat.sections.ai_reply.include_sender.description')"
      />

      <FieldRange
        v-model="aiReplyMaxLength"
        :label="t('settings.pages.modules.live_chat.sections.ai_reply.max_length.label')"
        :description="t('settings.pages.modules.live_chat.sections.ai_reply.max_length.description')"
        :min="20"
        :max="500"
        :step="10"
        :format-value="value => `${value.toFixed(0)}`"
      />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.live_chat.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
