import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useCaptionItems } from './useCaptionItems'

describe('useCaptionItems', () => {
  it('expires each caption event without cancelling earlier events of the same type', () => {
    vi.useFakeTimers()

    try {
      const captions = useCaptionItems({ ttlMs: 1000 })

      captions.add({ type: 'caption-speaker', text: 'first' })
      vi.advanceTimersByTime(500)
      captions.add({ type: 'caption-speaker', text: 'second' })

      expect(captions.items.value.map(item => item.text)).toEqual(['first', 'second'])

      vi.advanceTimersByTime(500)

      expect(captions.items.value.map(item => item.text)).toEqual(['second'])

      vi.advanceTimersByTime(500)

      expect(captions.items.value).toEqual([])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('reads the ttl from a ref so new items use updated settings', () => {
    vi.useFakeTimers()

    try {
      const ttlMs = ref(1000)
      const captions = useCaptionItems({ ttlMs })

      captions.add({ type: 'caption-live-chat', id: 'chat-1', username: 'Neko', text: 'hi' })
      ttlMs.value = 3000
      captions.add({ type: 'caption-live-chat', id: 'chat-2', username: 'Airi', text: 'yo' })

      // The first item keeps its original 1s TTL; the second uses the new 3s TTL.
      vi.advanceTimersByTime(1000)
      expect(captions.items.value.map(item => item.id)).toEqual([expect.any(Number)])

      vi.advanceTimersByTime(2000)
      expect(captions.items.value).toEqual([])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('clears caption items of the matching type when an empty event arrives', () => {
    vi.useFakeTimers()

    try {
      const captions = useCaptionItems({ ttlMs: 1000 })

      captions.add({ type: 'caption-speaker', text: 'speaker' })
      captions.add({ type: 'caption-assistant', text: 'assistant' })
      captions.add({ type: 'caption-speaker', text: '' })

      expect(captions.items.value.map(item => item.text)).toEqual(['assistant'])

      vi.advanceTimersByTime(1000)

      expect(captions.items.value).toEqual([])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('keeps live chat sender details and removes the oldest item at the limit', () => {
    vi.useFakeTimers()

    try {
      const captions = useCaptionItems({ ttlMs: 1000, maxItems: 2 })

      captions.add({ type: 'caption-speaker', text: 'speaker' })
      captions.add({ type: 'caption-live-chat', id: 'chat-1', username: 'Neko', text: 'first', avatar: 'avatar.png', color: '#fff' })
      captions.add({ type: 'caption-live-chat', id: 'chat-2', username: 'Airi', text: 'second' })

      expect(captions.items.value).toEqual([
        expect.objectContaining({ type: 'caption-live-chat', username: 'Neko', text: 'first', avatar: 'avatar.png', color: '#fff' }),
        expect.objectContaining({ type: 'caption-live-chat', username: 'Airi', text: 'second' }),
      ])

      vi.advanceTimersByTime(1000)

      expect(captions.items.value).toEqual([])
    }
    finally {
      vi.useRealTimers()
    }
  })
})
