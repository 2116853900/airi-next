# stage-tamagotchi-unibarrage

Vendored **UniBarrage** — a high-performance, multi-platform live danmaku
(弹幕) proxy/forwarder written in Go. It connects to live-streaming platforms,
normalizes every message into one WebSocket/JSON shape, and forwards it in
real time.

This workspace engine is bundled by the desktop app (`stage-tamagotchi`) as a
native sidecar: the Electron main process spawns the compiled binary at app
startup and the in-app live-chat connector registers rooms through its HTTP API
and consumes the unified push over WebSocket. Bilibili and Douyin are the
platforms wired into the app today; Kuaishou, Douyu and Huya are supported by
the engine but not surfaced in the UI.

## What it does

- Connects to Bilibili / Douyin (and Kuaishou / Douyu / Huya) live rooms.
- Normalizes chat, gift, subscribe, super-chat, like, enter-room and end-live
  events into `{ rid, platform, type, data }` WebSocket messages.
- Serves a REST API to start/stop/list rooms (`/api/v1/...`).

Compared to upstream, this fork adds `level` (platform user level) and
`medalLevel` (Bilibili fans-medal level) to the unified message `data`, so
consumers can render a `Lv.N` badge. The app applies a user-level-first,
medal-fallback policy in its message mapper.

## Upstream

- Repo: <https://github.com/BarryWangQwQ/UniBarrage>
- Vendored at commit `ea0d7d0314615a2743e424f0f30a6a700018f01a`.
- Upstream docs: `docs/upstream-readme.md`.

**License:** UniBarrage is **GPL v3** (a commercial license is also offered by
the upstream author). The GPL applies to this engine module; see `LICENSE`.
Do not relicense.

## Build

Requires a Go toolchain (>= 1.23). Builds are pure Go (`CGO_ENABLED=0`), so a
single host can cross-compile every target:

```bash
# current platform/arch
pnpm -F @proj-airi/stage-tamagotchi-unibarrage build

# explicit target (used by CI/release)
node ./scripts/build.mjs --os linux --arch x64
node ./scripts/build.mjs --os win --arch arm64
```

Output lands in `out/<os>/unibarrage[.exe]` with `os` in `win|mac|linux` — the
same layout `electron-builder` consumes via `extraResources`
(`engines/stage-tamagotchi-unibarrage/out/${os}` → app `resources/unibarrage/`).

## Usage in the app

The main process (`apps/stage-tamagotchi/src/main/services/airi/unibarrage`)
spawns the binary at startup, picks free ports, waits for the API to answer
`GET /api/v1/`, and exposes the effective bridge config (`ws`, `api`, token) to
the live-chat connector. No manual bridge configuration is needed.

Dev mode resolves the binary at
`engines/stage-tamagotchi-unibarrage/out/<os>/unibarrage[.exe]` (or
`UNIBARRAGE_BIN` if set); build it once before `pnpm -F @proj-airi/stage-tamagotchi dev`.
Packaged builds ship the binary under `resources/unibarrage/`.

## Not for

- Use outside `stage-tamagotchi` (the app owns the process lifecycle and bridge
  wiring).
- Platforms beyond Bilibili/Douyin in the current app settings — the engine
  code is present, but the connector and room settings only exercise those two.
