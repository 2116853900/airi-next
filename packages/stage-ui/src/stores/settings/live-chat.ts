import type { LiveChatAiReplyTrigger } from '@proj-airi/stage-shared/live-chat'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsLiveChat = defineStore('settings-live-chat', () => {
  /** Whether live chat (danmaku) messages show on the caption overlay. */
  const showOnCaptionOverlay = useLocalStorageManualReset<boolean>('settings/live-chat/show-on-caption-overlay', true)
  /** How many live chat messages stay visible at once. */
  const maxItems = useLocalStorageManualReset<number>('settings/live-chat/max-items', 3)
  /** How long a caption overlay message (danmaku or subtitle) stays before it disappears. */
  const ttlMs = useLocalStorageManualReset<number>('settings/live-chat/ttl-ms', 10_000)
  /** Message font size in pixels. */
  const fontSize = useLocalStorageManualReset<number>('settings/live-chat/font-size', 14)
  /** Message background opacity, 0..1. */
  const opacity = useLocalStorageManualReset<number>('settings/live-chat/opacity', 0.72)
  /** Danmaku overlay background opacity, 0..1. */
  const bgOpacity = useLocalStorageManualReset<number>('settings/live-chat/bg-opacity', 0.3)
  /** Danmaku text color as hex. */
  const textColor = useLocalStorageManualReset<string>('settings/live-chat/text-color', '#f5f5f5')
  /** Whether to show user level badge. */
  const showLevel = useLocalStorageManualReset<boolean>('settings/live-chat/show-level', true)
  /** Per-message background color as hex. */
  const msgBgColor = useLocalStorageManualReset<string>('settings/live-chat/msg-bg-color', '#000000')
  /** Per-message background opacity, 0..1. */
  const msgBgOpacity = useLocalStorageManualReset<number>('settings/live-chat/msg-bg-opacity', 0.5)
  /** Level-to-color mapping JSON: { "1": "#ff0000", "2": "#00ff00" } */
  const levelColors = useLocalStorageManualReset<string>('settings/live-chat/level-colors', '{}')
  /** Whether repeated danmaku text is suppressed on the danmaku overlay. */
  const dedupeEnabled = useLocalStorageManualReset<boolean>('settings/live-chat/dedupe-enabled', true)
  /** Sliding window in ms in which the same danmaku text may repeat at most `dedupeMaxRepeats` times. */
  const dedupeWindowMs = useLocalStorageManualReset<number>('settings/live-chat/dedupe-window-ms', 30_000)
  /** Max times the same danmaku text may be shown within the dedupe window. */
  const dedupeMaxRepeats = useLocalStorageManualReset<number>('settings/live-chat/dedupe-max-repeats', 1)
  /** Whether the character replies with voice to qualifying danmaku. */
  const aiReplyEnabled = useLocalStorageManualReset<boolean>('settings/live-chat/ai-reply-enabled', false)
  /** When the character replies: only when mentioned, or to every danmaku. */
  const aiReplyTrigger = useLocalStorageManualReset<LiveChatAiReplyTrigger>('settings/live-chat/ai-reply-trigger', 'mention')
  /** Extra comma-separated trigger keywords besides the character name. */
  const aiReplyTriggerKeywords = useLocalStorageManualReset<string>('settings/live-chat/ai-reply-trigger-keywords', '')
  /** Minimum gap between two AI replies, in milliseconds. */
  const aiReplyCooldownMs = useLocalStorageManualReset<number>('settings/live-chat/ai-reply-cooldown-ms', 15_000)
  /** Whether to prefix the ingest text with the danmaku sender name. */
  const aiReplyIncludeSender = useLocalStorageManualReset<boolean>('settings/live-chat/ai-reply-include-sender', true)
  /** Danmaku longer than this many characters is ignored. */
  const aiReplyMaxLength = useLocalStorageManualReset<number>('settings/live-chat/ai-reply-max-length', 120)
  /** Whether live-chat song request commands are accepted. */
  const songRequestEnabled = useLocalStorageManualReset<boolean>('settings/live-chat/song-request-enabled', true)
  /** Playback volume for requested songs, from 0 to 1. */
  const songRequestVolume = useLocalStorageManualReset<number>('settings/live-chat/song-request-volume', 0.5)
  /** Maximum accepted requests, including the currently playing song. */
  const songRequestQueueLimit = useLocalStorageManualReset<number>('settings/live-chat/song-request-queue-limit', 20)
  /** Minimum gap between accepted requests from one viewer. */
  const songRequestUserCooldownMs = useLocalStorageManualReset<number>('settings/live-chat/song-request-user-cooldown-ms', 30_000)

  function resetState() {
    showOnCaptionOverlay.value = true
    maxItems.value = 3
    ttlMs.value = 10_000
    fontSize.value = 14
    opacity.value = 0.72
    bgOpacity.value = 0.3
    textColor.value = '#f5f5f5'
    showLevel.value = true
    msgBgColor.value = '#000000'
    msgBgOpacity.value = 0.5
    levelColors.value = '{}'
    dedupeEnabled.value = true
    dedupeWindowMs.value = 30_000
    dedupeMaxRepeats.value = 1
    aiReplyEnabled.value = false
    aiReplyTrigger.value = 'mention'
    aiReplyTriggerKeywords.value = ''
    aiReplyCooldownMs.value = 15_000
    aiReplyIncludeSender.value = true
    aiReplyMaxLength.value = 120
    songRequestEnabled.value = true
    songRequestVolume.value = 0.5
    songRequestQueueLimit.value = 20
    songRequestUserCooldownMs.value = 30_000
  }

  return {
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
    songRequestEnabled,
    songRequestVolume,
    songRequestQueueLimit,
    songRequestUserCooldownMs,
    resetState,
  }
})
