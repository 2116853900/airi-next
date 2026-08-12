<script setup lang="ts">
import type {
  SongRequestLoginSource,
  SongRequestLoginState,
  SongRequestQrLoginCheckResult,
  SongRequestQrLoginSession,
  SongRequestQrLoginStatus,
} from '@proj-airi/stage-shared/song-request'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { errorMessageFrom } from '@moeru/std'
import {
  songRequestLoginClearInvokeEventa,
  songRequestLoginQrCheckInvokeEventa,
  songRequestLoginQrCreateInvokeEventa,
  songRequestLoginStateInvokeEventa,
} from '@proj-airi/stage-shared/song-request'
import { Button } from '@proj-airi/ui'
import { renderSVG } from 'uqr'
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

/** How often a pending QR session polls the platform for the scan result. */
const LOGIN_POLL_INTERVAL_MS = 2_000

interface LoginRow {
  /** Source whose saved cookie this row reflects. */
  statusSource: string
  labelKey: string
  /** Login flows offered by this row; qq has both QQ and WeChat scans. */
  flows: Array<{ source: SongRequestLoginSource, labelKey: string }>
}

const accountRows: LoginRow[] = [
  {
    statusSource: 'netease',
    labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.sources.netease',
    flows: [{ source: 'netease', labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.login' }],
  },
  {
    statusSource: 'qq',
    labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.sources.qq',
    flows: [
      { source: 'qq', labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.login' },
      { source: 'qq_wx', labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.login_wx' },
    ],
  },
  {
    statusSource: 'kugou',
    labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.sources.kugou',
    flows: [{ source: 'kugou', labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.login' }],
  },
  {
    statusSource: 'bilibili',
    labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.sources.bilibili',
    flows: [{ source: 'bilibili', labelKey: 'settings.pages.modules.live_chat.sections.song_request.accounts.login' }],
  },
]

interface ActiveLogin {
  source: SongRequestLoginSource
  statusSource: string
  session: SongRequestQrLoginSession
  /** Locally rendered QR (from session.url); falls back to session.imageUrl. */
  qrSvgDataUrl?: string
  status: SongRequestQrLoginStatus
  message?: string
}

const { t } = useI18n()

const loginState = shallowRef<Record<string, boolean>>({})
const activeLogin = shallowRef<ActiveLogin | null>(null)
const isBusy = shallowRef(false)

let invokes: {
  create: (input: { source: string }) => Promise<SongRequestQrLoginSession>
  check: (input: { source: string, key: string }) => Promise<SongRequestQrLoginCheckResult>
  state: () => Promise<SongRequestLoginState>
  clear: (input: { source: string }) => Promise<SongRequestLoginState>
} | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined

const activeStatusText = computed(() => {
  const active = activeLogin.value
  if (!active)
    return ''
  const base = t(`settings.pages.modules.live_chat.sections.song_request.accounts.status.${active.status}`)
  return active.message ? `${base} — ${active.message}` : base
})

function getElectronIpcRenderer() {
  return (window as Window & {
    electron?: { ipcRenderer?: unknown }
  }).electron?.ipcRenderer
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

async function refreshLoginState(): Promise<void> {
  if (!invokes)
    return
  try {
    loginState.value = (await invokes.state()).sources
  }
  catch {
    // The sidecar may still be booting; rows simply show signed-out.
  }
}

function qrSvgDataUrl(payload: string): string {
  // Dark-on-white regardless of theme so phone scanners always detect it
  // (see server-channel-qr-card.vue for the scanner background).
  const svg = renderSVG(payload, {
    border: 2,
    ecc: 'M',
    pixelSize: 8,
    whiteColor: '#FFFFFF',
    blackColor: '#121212',
  })
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

async function pollActiveLogin(): Promise<void> {
  const active = activeLogin.value
  if (!active || !invokes)
    return

  let result: SongRequestQrLoginCheckResult
  try {
    result = await invokes.check({ source: active.source, key: active.session.key })
  }
  catch {
    // Transient IPC/network failure; the next poll retries.
    return
  }

  // A newer session may have replaced this one while the check was in flight.
  if (activeLogin.value?.session.key !== active.session.key)
    return

  if (result.status === 'success') {
    stopPolling()
    activeLogin.value = null
    await refreshLoginState()
    toast.success(t('settings.pages.modules.live_chat.sections.song_request.accounts.messages.success'))
    return
  }

  activeLogin.value = { ...active, status: result.status, message: result.message }
  if (result.status === 'expired' || result.status === 'failed')
    stopPolling()
}

async function startLogin(row: LoginRow, source: SongRequestLoginSource): Promise<void> {
  if (!invokes || isBusy.value)
    return

  isBusy.value = true
  stopPolling()
  try {
    const session = await invokes.create({ source })
    activeLogin.value = {
      source,
      statusSource: row.statusSource,
      session,
      qrSvgDataUrl: session.url ? qrSvgDataUrl(session.url) : undefined,
      status: 'waiting',
    }
    pollTimer = setInterval(() => void pollActiveLogin(), LOGIN_POLL_INTERVAL_MS)
  }
  catch (error) {
    toast.error(errorMessageFrom(error) ?? t('settings.pages.modules.live_chat.sections.song_request.accounts.messages.create_failed'))
  }
  finally {
    isBusy.value = false
  }
}

async function retryActiveLogin(): Promise<void> {
  const active = activeLogin.value
  if (!active)
    return
  const row = accountRows.find(candidate => candidate.statusSource === active.statusSource)
  if (row)
    await startLogin(row, active.source)
}

function cancelLogin(): void {
  stopPolling()
  activeLogin.value = null
}

async function signOut(row: LoginRow): Promise<void> {
  if (!invokes || isBusy.value)
    return

  isBusy.value = true
  try {
    loginState.value = (await invokes.clear({ source: row.statusSource })).sources
    toast.success(t('settings.pages.modules.live_chat.sections.song_request.accounts.messages.signed_out'))
  }
  catch (error) {
    toast.error(errorMessageFrom(error) ?? t('settings.pages.modules.live_chat.sections.song_request.accounts.messages.sign_out_failed'))
  }
  finally {
    isBusy.value = false
  }
}

onMounted(async () => {
  const ipcRenderer = getElectronIpcRenderer()
  if (!ipcRenderer)
    return

  const { context } = createContext(ipcRenderer as Parameters<typeof createContext>[0])
  invokes = {
    create: defineInvoke(context, songRequestLoginQrCreateInvokeEventa),
    check: defineInvoke(context, songRequestLoginQrCheckInvokeEventa),
    state: defineInvoke(context, songRequestLoginStateInvokeEventa),
    clear: defineInvoke(context, songRequestLoginClearInvokeEventa),
  }
  await refreshLoginState()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div :class="['border-t border-neutral-200 pt-4 dark:border-neutral-800']">
    <div :class="['mb-3']">
      <div :class="['text-sm text-neutral-800 font-medium dark:text-neutral-100']">
        {{ t('settings.pages.modules.live_chat.sections.song_request.accounts.title') }}
      </div>
      <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.modules.live_chat.sections.song_request.accounts.description') }}
      </div>
    </div>

    <div :class="['flex flex-col gap-2']">
      <div
        v-for="row in accountRows"
        :key="row.statusSource"
        :class="['grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3']"
      >
        <div :class="['flex min-w-0 items-center gap-2']">
          <span
            :class="[
              'h-2 w-2 shrink-0 rounded-full',
              loginState[row.statusSource] ? 'bg-green-500' : 'bg-neutral-300 dark:bg-neutral-600',
            ]"
          />
          <span :class="['truncate text-sm text-neutral-700 dark:text-neutral-200']">
            {{ t(row.labelKey) }}
          </span>
          <span :class="['shrink-0 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ loginState[row.statusSource]
              ? t('settings.pages.modules.live_chat.sections.song_request.accounts.logged_in')
              : t('settings.pages.modules.live_chat.sections.song_request.accounts.logged_out') }}
          </span>
        </div>
        <div :class="['flex items-center gap-2']">
          <Button
            v-for="flow in row.flows"
            :key="flow.source"
            size="sm"
            :disabled="isBusy"
            @click="startLogin(row, flow.source)"
          >
            {{ t(flow.labelKey) }}
          </Button>
          <Button
            v-if="loginState[row.statusSource]"
            size="sm"
            :disabled="isBusy"
            @click="signOut(row)"
          >
            {{ t('settings.pages.modules.live_chat.sections.song_request.accounts.logout') }}
          </Button>
        </div>
      </div>
    </div>

    <div
      v-if="activeLogin"
      :class="['mt-3 flex flex-col items-center gap-2 rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900']"
    >
      <img
        v-if="activeLogin.qrSvgDataUrl ?? activeLogin.session.imageUrl"
        :src="activeLogin.qrSvgDataUrl ?? activeLogin.session.imageUrl"
        :alt="t('settings.pages.modules.live_chat.sections.song_request.accounts.qr_alt')"
        :class="['h-44 w-44 rounded bg-white p-1']"
      >
      <div :class="['text-xs text-neutral-600 dark:text-neutral-300']">
        {{ activeStatusText }}
      </div>
      <div :class="['flex items-center gap-2']">
        <Button
          v-if="activeLogin.status === 'expired' || activeLogin.status === 'failed'"
          size="sm"
          :disabled="isBusy"
          @click="retryActiveLogin"
        >
          {{ t('settings.pages.modules.live_chat.sections.song_request.accounts.retry') }}
        </Button>
        <Button size="sm" @click="cancelLogin">
          {{ t('settings.pages.modules.live_chat.sections.song_request.accounts.cancel') }}
        </Button>
      </div>
    </div>
  </div>
</template>
