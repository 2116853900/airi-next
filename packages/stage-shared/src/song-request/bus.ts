import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

const SONG_REQUEST_BUS_CHANNEL = 'airi::song-request'

let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined
let channel: BroadcastChannel | undefined

/** Returns the Eventa context shared by same-origin desktop renderer windows. */
export function getSongRequestBusContext() {
  if (!channel)
    channel = new BroadcastChannel(SONG_REQUEST_BUS_CHANNEL)
  context ??= createBroadcastChannelContext(channel).context
  return context
}
