import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { useWatchAlongSessionStore } from '../../modules/watch-along/session'

const WATCH_ALONG_CONTEXT_ID = 'system:watch-along'

/**
 * Injects the current watch-along state into every chat turn while a watch
 * session runs, so the character can answer questions such as "what is this
 * video about" without a fresh vision call.
 */
export function createWatchAlongContext(): ContextMessage | null {
  const session = useWatchAlongSessionStore()

  if (session.status !== 'watching')
    return null

  const latestObservation = session.latestObservation
  if (!latestObservation)
    return null

  const sourceLabel = session.activeSourceName ? ` ("${session.activeSourceName}")` : ''
  const summary = session.lastSummaryText.trim()

  return {
    id: nanoid(),
    contextId: WATCH_ALONG_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      `You are watching a video${sourceLabel} together with your user right now.`,
      `Latest frame observation: ${latestObservation.text}`,
      summary ? `Last video summary: ${summary}` : '',
      'Use this context when your user talks about the video.',
    ].filter(Boolean).join(' '),
    createdAt: Date.now(),
  }
}
