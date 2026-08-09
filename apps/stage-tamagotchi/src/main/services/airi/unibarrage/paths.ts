import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Maps a Node platform to the engine build output dir (`out/<os>`). */
export function engineOsForPlatform(platform: NodeJS.Platform): 'win' | 'mac' | 'linux' {
  if (platform === 'win32')
    return 'win'
  if (platform === 'darwin')
    return 'mac'
  return 'linux'
}

/** Binary file name inside the engine output dir for a platform. */
export function binaryNameForPlatform(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'unibarrage.exe' : 'unibarrage'
}

/** Packaged-app binary under Electron resources (`resources/unibarrage/`). */
export function packagedBinaryPath(platform: NodeJS.Platform, resourcesPath: string): string {
  return join(resourcesPath, 'unibarrage', binaryNameForPlatform(platform))
}

/**
 * Dev-mode binary under the workspace engines dir, walking up from `originDir`.
 *
 * @example
 * devBinaryPath('linux', '/repo/apps/stage-tamagotchi/out/main')
 * // => '/repo/engines/stage-tamagotchi-unibarrage/out/linux/unibarrage'
 */
export async function devBinaryPath(platform: NodeJS.Platform, originDir: string): Promise<string | undefined> {
  const os = engineOsForPlatform(platform)
  const name = binaryNameForPlatform(platform)
  let currentDirectory = originDir
  while (true) {
    const candidate = join(currentDirectory, 'engines', 'stage-tamagotchi-unibarrage', 'out', os, name)
    try {
      await access(candidate)
      return candidate
    }
    catch {
      // not at this level; keep walking up
    }
    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory)
      return undefined
    currentDirectory = parentDirectory
  }
}

/** CLI arguments passed to the UniBarrage binary. */
export function buildSpawnArgs(options: { wsPort: number, apiPort: number, token: string }): string[] {
  return [
    '-wsHost',
    '127.0.0.1',
    '-wsPort',
    String(options.wsPort),
    '-apiHost',
    '127.0.0.1',
    '-apiPort',
    String(options.apiPort),
    '-authToken',
    options.token,
    '-logLevel',
    '1',
  ]
}
