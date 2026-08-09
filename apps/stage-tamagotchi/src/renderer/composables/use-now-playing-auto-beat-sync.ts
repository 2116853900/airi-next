import { defineInvoke } from '@moeru/eventa'
import { useElectronEventaContext } from '@proj-airi/electron-vueuse'
import { getBeatSyncState, toggleBeatSync } from '@proj-airi/stage-shared/beat-sync'
import { nowPlayingGetStateInvokeEventa, nowPlayingSetEnabledInvokeEventa, nowPlayingStateChangedInvokeEventa } from '@proj-airi/stage-shared/now-playing'
import { useSettingsNowPlaying } from '@proj-airi/stage-ui/stores/settings'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted } from 'vue'

/**
 * Auto-enables beat sync while a song is playing on the machine.
 *
 * Live2D already subscribes to beat signals globally (`Model.vue` schedules
 * bounces on `listenBeatSyncBeatSignal`), so this composable only needs to
 * flip the detector on once per playback session. It never disables beat
 * sync, so a manual stop by the user is respected.
 */
export function useNowPlayingAutoBeatSync() {
  const { autoBeatSync, enabled } = storeToRefs(useSettingsNowPlaying())
  const context = useElectronEventaContext()
  const getState = defineInvoke(context.value, nowPlayingGetStateInvokeEventa)
  const setEnabled = defineInvoke(context.value, nowPlayingSetEnabledInvokeEventa)
  let removeListener: (() => void) | undefined
  let enabledOnce = false

  async function enableWhenPlaying(status: string) {
    if (status !== 'playing' || !autoBeatSync.value || enabledOnce)
      return

    const state = await getBeatSyncState().catch(() => undefined)
    if (state?.isActive) {
      enabledOnce = true
      return
    }

    enabledOnce = true
    void Promise.resolve(toggleBeatSync(true)).catch(() => {
      // Screen-capture permission may be denied; the settings page can retry.
    })
  }

  onMounted(() => {
    // The engine starts eagerly in main; honor a persisted master switch.
    if (!enabled.value)
      void setEnabled(false).catch(() => {})

    removeListener = context.value.on(nowPlayingStateChangedInvokeEventa, (event) => {
      if (event?.body)
        void enableWhenPlaying(event.body.status)
    })

    void getState().then((snapshot) => {
      void enableWhenPlaying(snapshot.status)
    }).catch(() => {})
  })

  onUnmounted(() => {
    removeListener?.()
    removeListener = undefined
  })
}
