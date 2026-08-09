import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { binaryNameForPlatform, buildSpawnArgs, devBinaryPath, engineOsForPlatform, packagedBinaryPath } from './paths'

describe('engineOsForPlatform', () => {
  it('maps node platforms to engine output dirs', () => {
    expect(engineOsForPlatform('win32')).toBe('win')
    expect(engineOsForPlatform('darwin')).toBe('mac')
    expect(engineOsForPlatform('linux')).toBe('linux')
  })
})

describe('binaryNameForPlatform', () => {
  it('appends .exe on windows', () => {
    expect(binaryNameForPlatform('win32')).toBe('unibarrage.exe')
    expect(binaryNameForPlatform('linux')).toBe('unibarrage')
  })
})

describe('packagedBinaryPath', () => {
  it('resolves under resources/unibarrage', () => {
    expect(packagedBinaryPath('linux', '/resources')).toBe('/resources/unibarrage/unibarrage')
    expect(packagedBinaryPath('win32', 'C:\\resources')).toBe(join('C:\\resources', 'unibarrage', 'unibarrage.exe'))
  })
})

describe('buildSpawnArgs', () => {
  it('passes host, ports, token, and log level', () => {
    expect(buildSpawnArgs({ wsPort: 7000, apiPort: 8000, token: 'abc' })).toEqual([
      '-wsHost',
      '127.0.0.1',
      '-wsPort',
      '7000',
      '-apiHost',
      '127.0.0.1',
      '-apiPort',
      '8000',
      '-authToken',
      'abc',
      '-logLevel',
      '1',
    ])
  })
})

describe('devBinaryPath', () => {
  const root = mkdtempSync(join(tmpdir(), 'airi-unibarrage-test-'))

  it('walks up to find the engines output binary', async () => {
    const binaryDir = join(root, 'engines', 'stage-tamagotchi-unibarrage', 'out', 'linux')
    mkdirSync(binaryDir, { recursive: true })
    writeFileSync(join(binaryDir, 'unibarrage'), '')

    const origin = join(root, 'apps', 'stage-tamagotchi', 'out', 'main')
    expect(await devBinaryPath('linux', origin)).toBe(join(binaryDir, 'unibarrage'))
  })

  it('returns undefined when no engine output exists up the tree', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'airi-unibarrage-empty-'))
    const origin = join(emptyRoot, 'unrelated')
    mkdirSync(origin, { recursive: true })
    expect(await devBinaryPath('linux', origin)).toBeUndefined()
  })
})
