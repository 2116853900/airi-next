import type { BeatSyncDetectorState } from '@proj-airi/stage-shared/beat-sync'
import type { NowPlayingState } from '@proj-airi/stage-shared/now-playing'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { getBeatSyncState, isBeatSyncSupported, listenBeatSyncStateChange } from '@proj-airi/stage-shared/beat-sync'
import { nowPlayingGetStateInvokeEventa, nowPlayingStateChangedInvokeEventa } from '@proj-airi/stage-shared/now-playing'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import factorioIcon from '../assets/factorio-simple.png'

import { useArtistryStore } from '../stores/modules/artistry'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useDiscordStore } from '../stores/modules/discord'
import { useFactorioStore } from '../stores/modules/gaming-factorio'
import { useMinecraftStore } from '../stores/modules/gaming-minecraft'
import { useHearingStore } from '../stores/modules/hearing'
import { useSpeechStore } from '../stores/modules/speech'
import { useTwitterStore } from '../stores/modules/twitter'
import { useVisionStore } from '../stores/modules/vision'
import { useWatchAlongStore } from '../stores/modules/watch-along'
import { useWebSearchStore } from '../stores/modules/web-search'

export interface Module {
  id: string
  name: string
  description: string
  icon?: string
  iconColor?: string
  iconImage?: string
  to: string
  configured: boolean
  category: string
}

export function useModulesList() {
  const { t } = useI18n()

  // Initialize stores
  const consciousnessStore = useConsciousnessStore()
  const speechStore = useSpeechStore()
  const hearingStore = useHearingStore()
  const visionStore = useVisionStore()
  const watchAlongStore = useWatchAlongStore()
  const discordStore = useDiscordStore()
  const twitterStore = useTwitterStore()
  const webSearchStore = useWebSearchStore()
  const minecraftStore = useMinecraftStore()
  const factorioStore = useFactorioStore()
  const artistryStore = useArtistryStore()
  const beatSyncState = ref<BeatSyncDetectorState>()
  const beatSyncSupported = isBeatSyncSupported()
  const nowPlayingState = ref<NowPlayingState>()

  minecraftStore.initialize()

  const modulesList = computed<Module[]>(() => [
    {
      id: 'consciousness',
      name: t('settings.pages.modules.consciousness.title'),
      description: t('settings.pages.modules.consciousness.description'),
      icon: 'i-solar:ghost-bold-duotone',
      to: '/settings/modules/consciousness',
      configured: consciousnessStore.configured,
      category: 'essential',
    },
    {
      id: 'speech',
      name: t('settings.pages.modules.speech.title'),
      description: t('settings.pages.modules.speech.description'),
      icon: 'i-solar:user-speak-rounded-bold-duotone',
      to: '/settings/modules/speech',
      configured: speechStore.configured,
      category: 'essential',
    },
    {
      id: 'hearing',
      name: t('settings.pages.modules.hearing.title'),
      description: t('settings.pages.modules.hearing.description'),
      icon: 'i-solar:microphone-3-bold-duotone',
      to: '/settings/modules/hearing',
      configured: hearingStore.configured,
      category: 'essential',
    },
    {
      id: 'vision',
      name: t('settings.pages.modules.vision.title'),
      description: t('settings.pages.modules.vision.description'),
      icon: 'i-solar:eye-closed-bold-duotone',
      to: '/settings/modules/vision',
      configured: visionStore.configured,
      category: 'essential',
    },
    {
      id: 'web-search',
      name: t('settings.pages.modules.web-search.title'),
      description: t('settings.pages.modules.web-search.description'),
      icon: 'i-solar:magnifer-bold-duotone',
      to: '/settings/modules/web-search',
      configured: webSearchStore.configured,
      category: 'essential',
    },
    {
      id: 'artistry',
      name: t('settings.pages.modules.artistry.title'),
      description: t('settings.pages.modules.artistry.description'),
      icon: 'i-solar:palette-bold-duotone',
      to: '/settings/modules/artistry',
      configured: artistryStore.configured,
      category: 'essential',
    },
    {
      id: 'memory-short-term',
      name: t('settings.pages.modules.memory-short-term.title'),
      description: t('settings.pages.modules.memory-short-term.description'),
      icon: 'i-solar:bookmark-bold-duotone',
      to: '/settings/modules/memory-short-term',
      configured: false,
      category: 'essential',
    },
    {
      id: 'memory-long-term',
      name: t('settings.pages.modules.memory-long-term.title'),
      description: t('settings.pages.modules.memory-long-term.description'),
      icon: 'i-solar:book-bookmark-bold-duotone',
      to: '/settings/modules/memory-long-term',
      configured: false,
      category: 'essential',
    },
    {
      id: 'messaging-discord',
      name: t('settings.pages.modules.messaging-discord.title'),
      description: t('settings.pages.modules.messaging-discord.description'),
      icon: 'i-simple-icons:discord',
      to: '/settings/modules/messaging-discord',
      configured: discordStore.configured,
      category: 'messaging',
    },
    {
      id: 'x',
      name: t('settings.pages.modules.x.title'),
      description: t('settings.pages.modules.x.description'),
      icon: 'i-simple-icons:x',
      to: '/settings/modules/x',
      configured: twitterStore.configured,
      category: 'messaging',
    },
    {
      id: 'live-chat',
      name: t('settings.pages.modules.live_chat.title'),
      description: t('settings.pages.modules.live_chat.description'),
      icon: 'i-solar:chat-round-bold-duotone',
      to: '/settings/modules/live-chat',
      configured: false,
      category: 'messaging',
    },
    {
      id: 'live-room',
      name: t('settings.pages.modules.live_room.title'),
      description: t('settings.pages.modules.live_room.description'),
      icon: 'i-solar:chat-square-bold-duotone',
      to: '/settings/modules/live-room',
      configured: false,
      category: 'messaging',
    },
    {
      id: 'gaming-minecraft',
      name: t('settings.pages.modules.gaming-minecraft.title'),
      description: t('settings.pages.modules.gaming-minecraft.description'),
      iconColor: 'i-vscode-icons:file-type-minecraft',
      to: '/settings/modules/gaming-minecraft',
      configured: minecraftStore.configured,
      category: 'gaming',
    },
    {
      id: 'gaming-factorio',
      name: t('settings.pages.modules.gaming-factorio.title'),
      description: t('settings.pages.modules.gaming-factorio.description'),
      iconImage: factorioIcon,
      to: '/settings/modules/gaming-factorio',
      configured: factorioStore.configured,
      category: 'gaming',
    },
    {
      id: 'mcp-server',
      name: t('settings.pages.modules.mcp-server.title'),
      description: t('settings.pages.modules.mcp-server.description'),
      icon: 'i-solar:server-bold-duotone',
      to: '/settings/modules/mcp',
      configured: false,
      category: 'essential',
    },
    ...(beatSyncSupported
      ? [{
          id: 'beat-sync',
          name: t('settings.pages.modules.beat_sync.title'),
          description: t('settings.pages.modules.beat_sync.description'),
          icon: 'i-solar:music-notes-bold-duotone',
          to: '/settings/modules/beat-sync',
          configured: beatSyncState.value?.isActive ?? false,
          category: 'essential',
        }]
      : []),
    // Watch-along depends on Electron screen capture, so the entry only
    // shows on the desktop edition.
    ...(isStageTamagotchi()
      ? [{
          id: 'watch-along',
          name: t('settings.pages.modules.watch_along.title'),
          description: t('settings.pages.modules.watch_along.description'),
          icon: 'i-solar:videocamera-record-bold-duotone',
          to: '/settings/modules/watch-along',
          configured: watchAlongStore.configured,
          category: 'essential',
        }]
      : []),
    {
      id: 'now-playing',
      name: t('settings.pages.modules.now_playing.title'),
      description: t('settings.pages.modules.now_playing.description'),
      icon: 'i-solar:vinyl-bold-duotone',
      to: '/settings/modules/now-playing',
      configured: nowPlayingState.value?.track != null && nowPlayingState.value.status !== 'stopped',
      category: 'essential',
    },
  ])

  const categorizedModules = computed(() => {
    return modulesList.value.reduce((categories, module) => {
      const { category } = module
      if (!categories[category]) {
        categories[category] = []
      }
      categories[category].push(module)
      return categories
    }, {} as Record<string, Module[]>)
  })

  // Define category display names
  const categoryNames = computed(() => ({
    essential: t('settings.pages.modules.categories.essential'),
    messaging: t('settings.pages.modules.categories.messaging'),
    gaming: t('settings.pages.modules.categories.gaming'),
  }))

  // TODO(Makito): We can make this a reactive value from a synthetic store.
  onMounted(() => {
    if (!beatSyncSupported)
      return

    getBeatSyncState().then(initialState => beatSyncState.value = initialState)
    const removeListener = listenBeatSyncStateChange(newState => beatSyncState.value = { ...newState })
    onUnmounted(() => removeListener())
  })

  onMounted(() => {
    if (!isStageTamagotchi())
      return

    const ipcRenderer = (window as Window & { electron?: { ipcRenderer?: unknown } }).electron?.ipcRenderer
    if (!ipcRenderer)
      return

    const { context } = createContext(ipcRenderer as Parameters<typeof createContext>[0])
    const getState = defineInvoke(context, nowPlayingGetStateInvokeEventa)
    const removeListener = context.on(nowPlayingStateChangedInvokeEventa, (event) => {
      if (event?.body)
        nowPlayingState.value = event.body
    })
    void getState().then((state) => {
      nowPlayingState.value = state
    }).catch(() => {})

    onUnmounted(() => removeListener())
  })

  return {
    modulesList,
    categorizedModules,
    categoryNames,
  }
}
