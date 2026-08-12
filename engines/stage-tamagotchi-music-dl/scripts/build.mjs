import process from 'node:process'

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const OS_PLATFORM = { win: 'windows', mac: 'darwin', linux: 'linux' }
const ARCH_GOARCH = { x64: 'amd64', arm64: 'arm64', x86: '386' }

function detectOs() {
  switch (process.platform) {
    case 'win32':
      return 'win'
    case 'darwin':
      return 'mac'
    default:
      return 'linux'
  }
}

function detectArch() {
  return process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64'
}

function parseArgs(argv) {
  const args = { os: undefined, arch: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--os')
      args.os = argv[index + 1]
    else if (argv[index] === '--arch')
      args.arch = argv[index + 1]
  }
  return args
}

const { os = detectOs(), arch = detectArch() } = parseArgs(process.argv.slice(2))
const goos = OS_PLATFORM[os]
const goarch = ARCH_GOARCH[arch]
if (!goos || !goarch) {
  console.error(`Unsupported target: os=${os} arch=${arch} (expected os in win|mac|linux, arch in x64|arm64|x86)`)
  process.exit(1)
}

const outDir = join(engineRoot, 'out', os)
mkdirSync(outDir, { recursive: true })
const output = join(outDir, os === 'win' ? 'music-dl.exe' : 'music-dl')

const result = spawnSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'], {
  cwd: engineRoot,
  env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
  stdio: 'inherit',
})

if (result.status !== 0)
  process.exit(result.status ?? 1)

console.info(`Built song request sidecar ${os}/${arch} -> ${output}`)
