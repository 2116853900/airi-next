import type { CaptionChannelEvent } from '@proj-airi/stage-shared'
import type { Ref } from 'vue'

import { readonly, shallowRef, toValue } from 'vue'

export interface CaptionItem {
  /** Stable render key and timer owner for one broadcast caption event. */
  id: number
  /** Caption source, used for styling and explicit type-level clears. */
  type: CaptionChannelEvent['type']
  /** Text payload rendered by the overlay. */
  text: string
  /** Optional live chat sender name. */
  username?: string
  /** Optional live chat avatar URL. */
  avatar?: string
  /** Optional live chat message color. */
  color?: string
}

export interface UseCaptionItemsOptions {
  /**
   * How long one caption event should stay visible before removing itself.
   * Accepts a ref so callers can react to settings changes without
   * recreating the store.
   *
   * @default 5000
   */
  ttlMs?: number | Ref<number>
  /** Maximum number of items kept in memory. */
  maxItems?: number
}

const defaultCaptionItemsOptions = {
  ttlMs: 5_000,
  maxItems: 80,
} satisfies Required<Omit<UseCaptionItemsOptions, 'ttlMs'>> & { ttlMs: number }

/**
 * Manages caption overlay items with per-event expiry.
 *
 * Use when:
 * - Broadcast caption updates should age out independently.
 * - Empty caption events should clear only the matching caption source.
 *
 * Expects:
 * - Callers pass plain caption broadcast events.
 * - Callers call `dispose()` when the owner outlives Vue component cleanup.
 *
 * Returns:
 * - Readonly caption items plus actions for adding events and clearing timers.
 */
export function useCaptionItems(options: UseCaptionItemsOptions = {}) {
  const { ttlMs, maxItems } = { ...defaultCaptionItemsOptions, ...options }
  const items = shallowRef<CaptionItem[]>([])
  const expiryTimers = new Map<CaptionItem['id'], ReturnType<typeof setTimeout>>()
  let nextId = 1

  function clearTimer(id: CaptionItem['id']) {
    const timer = expiryTimers.get(id)
    if (!timer)
      return

    clearTimeout(timer)
    expiryTimers.delete(id)
  }

  function remove(id: CaptionItem['id']) {
    clearTimer(id)
    items.value = items.value.filter(item => item.id !== id)
  }

  function clearType(type: CaptionChannelEvent['type']) {
    const matchedItems = items.value.filter(item => item.type === type)
    for (const item of matchedItems) {
      clearTimer(item.id)
    }
    items.value = items.value.filter(item => item.type !== type)
  }

  function add(event: CaptionChannelEvent) {
    if (!event.text.trim()) {
      clearType(event.type)
      return
    }

    const item: CaptionItem = {
      id: nextId++,
      type: event.type,
      text: event.text,
      username: event.type === 'caption-live-chat' ? event.username : undefined,
      avatar: event.type === 'caption-live-chat' ? event.avatar : undefined,
      color: event.type === 'caption-live-chat' ? event.color : undefined,
    }
    const nextItems = [...items.value, item]
    if (nextItems.length > maxItems) {
      const removedItems = nextItems.splice(0, nextItems.length - maxItems)
      for (const removedItem of removedItems)
        clearTimer(removedItem.id)
    }
    items.value = nextItems
    expiryTimers.set(item.id, setTimeout(() => {
      remove(item.id)
    }, toValue(ttlMs)))
  }

  function dispose() {
    for (const timer of expiryTimers.values()) {
      clearTimeout(timer)
    }
    expiryTimers.clear()
    items.value = []
  }

  return {
    items: readonly(items),
    add,
    clearType,
    dispose,
  }
}
