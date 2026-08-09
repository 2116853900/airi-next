# Bilibili live chat bridge

This plugin reads Bilibili live-room messages from a LAPLACE Event Bridge. It sends them to the AIRI server channel. Desktop ver. shows the messages in the Caption window.

## Run

Set these environment variables when the services do not use their default URLs:

- `LAPLACE_EVENT_BRIDGE_URL` (default: `ws://localhost:9696`)
- `LAPLACE_EVENT_BRIDGE_TOKEN`
- `AIRI_SERVER_URL` (default: `ws://localhost:6121/ws`)
- `AIRI_SERVER_TOKEN`

Build the plugin, then run `pnpm -F @proj-airi/airi-plugin-bilibili-laplace start`.

The LAPLACE bridge must already receive the target Bilibili live room events. The plugin forwards normal messages and Super Chat messages. It ignores empty messages and duplicate message ids.
