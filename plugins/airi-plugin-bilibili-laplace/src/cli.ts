#!/usr/bin/env node

import process from 'node:process'

import { createLiveChatBridge } from './index'

const bridge = createLiveChatBridge()

function stop() {
  bridge.stop()
  process.exit(0)
}

process.once('SIGINT', stop)
process.once('SIGTERM', stop)

void bridge.start().catch((error) => {
  console.error('[bilibili-laplace] Failed to start:', error)
  bridge.stop()
  process.exitCode = 1
})
