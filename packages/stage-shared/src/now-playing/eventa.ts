import type { NowPlayingState } from './types'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

// Invokes (renderer -> main)
export const nowPlayingGetStateInvokeEventa = defineInvokeEventa<NowPlayingState>('eventa:invoke:electron:now-playing:get-state')
export const nowPlayingSetEnabledInvokeEventa = defineInvokeEventa<void, boolean>('eventa:invoke:electron:now-playing:set-enabled')
export const nowPlayingRefreshLyricsInvokeEventa = defineInvokeEventa<void>('eventa:invoke:electron:now-playing:refresh-lyrics')

// Events (main -> renderer)
export const nowPlayingStateChangedInvokeEventa = defineEventa<NowPlayingState>('eventa:event:electron:now-playing:state-changed')
