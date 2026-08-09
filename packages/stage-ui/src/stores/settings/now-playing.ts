import type { NowPlayingLyricsSourceSetting } from '@proj-airi/stage-shared/now-playing'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsNowPlaying = defineStore('settings-now-playing', () => {
  const enabled = useLocalStorageManualReset<boolean>('settings/now-playing/enabled', true)
  const autoBeatSync = useLocalStorageManualReset<boolean>('settings/now-playing/auto-beat-sync', true)
  const lyricsSource = useLocalStorageManualReset<NowPlayingLyricsSourceSetting>(
    'settings/now-playing/lyrics-source',
    'lrclib-netease',
  )
  const showOnCaptionOverlay = useLocalStorageManualReset<boolean>('settings/now-playing/show-on-caption-overlay', true)

  function resetState() {
    enabled.value = true
    autoBeatSync.value = true
    lyricsSource.value = 'lrclib-netease'
    showOnCaptionOverlay.value = true
  }

  return {
    enabled,
    autoBeatSync,
    lyricsSource,
    showOnCaptionOverlay,
    resetState,
  }
})
