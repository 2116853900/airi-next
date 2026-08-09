<script setup lang="ts">
import type { ResizeDirection } from '@proj-airi/electron-eventa'

import { electron } from '@proj-airi/electron-eventa'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

const RESIZE_DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const resizeWindow = useElectronEventaInvoke(electron.window.resize)

/**
 * Starts a drag-resize session for one window edge or corner.
 *
 * The overlay window is frameless, so resizing happens by tracking pointer
 * deltas and forwarding them through the `electron.window.resize` invoke,
 * which the main process applies as bounds deltas.
 */
function startResize(event: MouseEvent, direction: ResizeDirection) {
  event.preventDefault()
  event.stopPropagation()

  let lastX = event.screenX
  let lastY = event.screenY

  const onMove = (moveEvent: MouseEvent) => {
    const deltaX = moveEvent.screenX - lastX
    const deltaY = moveEvent.screenY - lastY
    if (deltaX !== 0 || deltaY !== 0) {
      void resizeWindow({ deltaX, deltaY, direction })
      lastX = moveEvent.screenX
      lastY = moveEvent.screenY
    }
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-50">
    <div
      v-for="direction in RESIZE_DIRECTIONS"
      :key="direction"
      class="resize-handle [-webkit-app-region:no-drag] pointer-events-auto absolute"
      :class="`resize-${direction}`"
      @mousedown="startResize($event, direction)"
    />
  </div>
</template>

<style scoped>
.resize-handle {
  position: absolute;
}

.resize-n { top: 0; left: 12px; right: 12px; height: 4px; cursor: n-resize; }
.resize-s { bottom: 0; left: 12px; right: 12px; height: 4px; cursor: s-resize; }
.resize-e { top: 12px; right: 0; bottom: 12px; width: 4px; cursor: e-resize; }
.resize-w { top: 12px; bottom: 12px; left: 0; width: 4px; cursor: w-resize; }

.resize-nw { top: 0; left: 0; width: 12px; height: 12px; cursor: nw-resize; }
.resize-ne { top: 0; right: 0; width: 12px; height: 12px; cursor: ne-resize; }
.resize-sw { bottom: 0; left: 0; width: 12px; height: 12px; cursor: sw-resize; }
.resize-se { bottom: 0; right: 0; width: 12px; height: 12px; cursor: se-resize; }
</style>
