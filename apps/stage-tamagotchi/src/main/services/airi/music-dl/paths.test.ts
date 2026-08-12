import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { binaryNameForPlatform, buildSpawnArgs, devBinaryPath, engineOsForPlatform, packagedBinaryPath } from './paths'

describe('music-dl sidecar paths', () => {
  it('maps Node platforms to engine output directories', () => {
    expect(engineOsForPlatform('win32')).toBe('win')
    expect(engineOsForPlatform('darwin')).toBe('mac')
    expect(engineOsForPlatform('linux')).toBe('linux')
  })

  it('uses the Windows executable suffix only on Windows', () => {
    expect(binaryNameForPlatform('win32')).toBe('music-dl.exe')
    expect(binaryNameForPlatform('linux')).toBe('music-dl')
  })

  it('resolves packaged binaries under resources/music-dl', () => {
    expect(packagedBinaryPath('linux', '/resources')).toBe(join('/resources', 'music-dl', 'music-dl'))
    expect(packagedBinaryPath('win32', 'C:\\resources')).toBe(join('C:\\resources', 'music-dl', 'music-dl.exe'))
  })

  it('walks up to find a development binary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'airi-music-dl-test-'))
    const binaryDirectory = join(root, 'engines', 'stage-tamagotchi-music-dl', 'out', 'linux')
    mkdirSync(binaryDirectory, { recursive: true })
    writeFileSync(join(binaryDirectory, 'music-dl'), '')

    const binaryPath = devBinaryPath('linux', join(root, 'apps', 'stage-tamagotchi', 'out', 'main'))
    await expect(binaryPath).resolves.toBe(join(binaryDirectory, 'music-dl'))
  })

  it('builds explicit sidecar arguments', () => {
    expect(buildSpawnArgs({ port: 43123, token: 'secret' })).toEqual([
      '--port',
      '43123',
      '--token',
      'secret',
    ])
  })
})
