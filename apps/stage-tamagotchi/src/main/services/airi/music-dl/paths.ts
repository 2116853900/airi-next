import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function engineOsForPlatform(platform: NodeJS.Platform): 'win' | 'mac' | 'linux' {
  if (platform === 'win32')
    return 'win'
  if (platform === 'darwin')
    return 'mac'
  return 'linux'
}

export function binaryNameForPlatform(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'music-dl.exe' : 'music-dl'
}

/** Packaged sidecar path under Electron resources. */
export function packagedBinaryPath(platform: NodeJS.Platform, resourcesPath: string): string {
  return join(resourcesPath, 'music-dl', binaryNameForPlatform(platform))
}

/**
 * Finds the sidecar in a development workspace.
 *
 * @example
 * devBinaryPath('linux', '/repo/apps/stage-tamagotchi/out/main')
 * // => '/repo/engines/stage-tamagotchi-music-dl/out/linux/music-dl'
 */
export async function devBinaryPath(platform: NodeJS.Platform, originDir: string): Promise<string | undefined> {
  const os = engineOsForPlatform(platform)
  const name = binaryNameForPlatform(platform)
  let currentDirectory = originDir
  while (true) {
    const candidate = join(currentDirectory, 'engines', 'stage-tamagotchi-music-dl', 'out', os, name)
    try {
      await access(candidate)
      return candidate
    }
    catch {
      const parentDirectory = dirname(currentDirectory)
      if (parentDirectory === currentDirectory)
        return undefined
      currentDirectory = parentDirectory
    }
  }
}

export function buildSpawnArgs(options: { port: number, token: string }): string[] {
  return ['--port', String(options.port), '--token', options.token]
}
