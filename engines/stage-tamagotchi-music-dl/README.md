# stage-tamagotchi-music-dl

This engine resolves live-chat song requests for the AIRI desktop app. It uses
`go-music-dl` v1.0.33 to search supported music sources and resolve playable
audio streams.

The Electron main process starts this binary as a sidecar. The sidecar listens
only on `127.0.0.1`. A random bearer token protects the resolve API, and a
random capability URL protects each audio stream.

## Build

Install Go 1.25 or a newer compatible version. Then run:

```bash
pnpm -F @proj-airi/stage-tamagotchi-music-dl build
```

The command writes `music-dl` or `music-dl.exe` to `out/<os>/`. Use `--os` and
`--arch` with `scripts/build.mjs` to select a release target.

## Use

Start the AIRI desktop app after the binary exists. The main process finds the
development binary automatically. Packaged apps include it in
`resources/music-dl/`.

The sidecar API is internal. Do not expose it to a network or use it as a
general music service.

## License

This engine is licensed under AGPL-3.0-or-later because it links to
`go-music-dl`. See `LICENSE` for the complete terms.
