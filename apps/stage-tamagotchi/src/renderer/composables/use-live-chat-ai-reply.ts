import type { WebSocketEventInputLiveChat } from '@proj-airi/server-sdk'

import { errorMessageFrom } from '@moeru/std'
import { evaluateLiveChatReply } from '@proj-airi/stage-shared/live-chat'
import { useCharacterStore } from '@proj-airi/stage-ui/stores/character'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSettingsLiveChat } from '@proj-airi/stage-ui/stores/settings'
import { storeToRefs } from 'pinia'

/**
 * Wires live-room danmaku into the chat store so the character can reply with
 * voice. The main window owns this: it is the chat authority and hosts the
 * speech pipeline.
 */
export function useLiveChatAiReply() {
  const settings = useSettingsLiveChat()
  const characterStore = useCharacterStore()
  const chatStore = useChatStore()
  const chatSession = useChatSessionStore()
  const consciousnessStore = useConsciousnessStore()
  const { activeProvider, activeModel } = storeToRefs(consciousnessStore)
  const {
    aiReplyEnabled,
    aiReplyTrigger,
    aiReplyTriggerKeywords,
    aiReplyCooldownMs,
    aiReplyIncludeSender,
    aiReplyMaxLength,
  } = storeToRefs(settings)
  const { name: characterName } = storeToRefs(characterStore)

  const seenMessageIds = new Map<string, number>()
  let lastReplyAt = 0

  function parseTriggerKeywords(raw: string): string[] {
    return raw
      .split(',')
      .map(keyword => keyword.trim())
      .filter(Boolean)
  }

  function pruneSeen(now: number) {
    for (const [id, seenAt] of seenMessageIds) {
      if (now - seenAt >= aiReplyCooldownMs.value)
        seenMessageIds.delete(id)
    }
  }

  async function handleLiveChatMessage(message: WebSocketEventInputLiveChat): Promise<void> {
    if (!activeProvider.value || !activeModel.value) {
      console.warn('[live-chat-ai-reply] skip: no chat provider or model configured')
      return
    }

    const now = Date.now()
    const seenAt = seenMessageIds.get(message.messageId)
    const isDuplicate = seenAt !== undefined && now - seenAt < aiReplyCooldownMs.value
    seenMessageIds.set(message.messageId, now)
    pruneSeen(now)

    const decision = evaluateLiveChatReply(message, {
      enabled: aiReplyEnabled.value,
      trigger: aiReplyTrigger.value,
      characterName: characterName.value,
      triggerKeywords: parseTriggerKeywords(aiReplyTriggerKeywords.value),
      cooldownMs: aiReplyCooldownMs.value,
      includeSender: aiReplyIncludeSender.value,
      maxLength: aiReplyMaxLength.value,
      lastReplyAt,
      now,
      isDuplicate,
    })
    if (!decision.ok)
      return

    lastReplyAt = now

    try {
      await chatStore.send({
        sessionId: chatSession.activeSessionId,
        text: decision.text,
        input: { type: 'input:live-chat', data: message },
      })
    }
    catch (error) {
      console.warn('[live-chat-ai-reply] ingest failed:', errorMessageFrom(error))
    }
  }

  function dispose() {
    seenMessageIds.clear()
    lastReplyAt = 0
  }

  return {
    handleLiveChatMessage,
    dispose,
  }
}
