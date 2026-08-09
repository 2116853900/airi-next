<script setup lang="ts">
import NowPlayingLyricsPanel from '../components/now-playing-lyrics-panel.vue'
import OverlayWindowHandles from '../components/overlay-window-handles.vue'
</script>

<template>
  <div class="[-webkit-app-region:drag] relative h-full w-full">
    <NowPlayingLyricsPanel />
    <OverlayWindowHandles />
  </div>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
