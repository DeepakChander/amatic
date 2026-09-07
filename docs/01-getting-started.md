# 01 — Getting Started

## Prerequisites

| | Requirement | Notes |
|---|---|---|
| Node | >= 18 (tested on 24.16) | `engines` in root `package.json` |
| Package manager | yarn **1.22.22** | pinned via `packageManager` |
| Disk | ~3 GB for `node_modules` | 74,378 files |

**If `yarn` is not on your PATH**, use `corepack yarn` — it resolves to the pinned
1.22.22. Do **not** use `npm install`; it will create a `package-lock.json` alongside
`yarn.lock` and break the workspace resolution.

## 1. Install

```bash
corepack yarn install     # or: yarn install
```

Expect radix-ui peer-dependency warnings and a `husky install` failure
(`fatal: not a git repository`). Both are pre-existing and harmless.

## 2. Create `.env.local`

`amatic-app/server.js` loads `../.env.local` — that resolves to **`amatic-main/.env.local`**,
a sibling of the root `package.json`. **Not** inside `amatic-app/`. It is not committed and
not generated; you must create it by hand.

```bash
ANTHROPIC_API_KEY=sk-ant-...      # teaching brain + drawing recognition
GOOGLE_AI_API_KEY=...             # image generation (GOOGLE_GEMINI_API_KEY also accepted)
ELEVENLABS_API_KEY=...            # voice output
```

Optional:

| Variable | Default | Effect |
|---|---|---|
| `AI_SERVER_PORT` | 3001 | backend port |
| `VITE_APP_PORT` | 3000 | frontend port |
| `NODE_ENV` | — | `production` suppresses error detail in API responses |

Without this file the canvas still works fully. Every AI feature fails silently from the
user's point of view — the status dot never leaves `watching`.

## 3. Run

```bash
corepack yarn start
```

That is `yarn --cwd ./amatic-app dev:full`, which runs both processes under
`concurrently`. To run them separately (useful when debugging one side):

```bash
cd amatic-app && node server.js                        # backend  -> :3001
cd amatic-app && node ../node_modules/vite/bin/vite.js # frontend -> :3000
```

Vite has `open: true`, so it launches a browser tab automatically.

## 4. Verify

```bash
curl http://localhost:3001/health
```

```json
{
  "status": "ok",
  "service": "Amatic AI Backend",
  "models": { "claude": true, "gemini": true, "elevenlabs": true }
}
```

**Note the path is `/health`, not `/api/health`.** Any `false` means that key is missing
from `.env.local`.

Then open http://localhost:3000. You should see the canvas with a toolbar, a properties
panel on the left, and a green status dot in the bottom-right next to the shield and help
icons. Green means the mic is on and the AI is watching.

## 5. Confirm the AI actually works

Keys loading is not the same as the AI working. To prove the loop end to end:

1. Select the freedraw tool and draw something recognisable — a triangle, an arrow, a leaf
2. **Stop drawing and wait 3 seconds** (`IDLE_DEBOUNCE_MS`)
3. You should hear narration begin and see content appear on free canvas space

If nothing happens, check the backend console. `master.js` logs errors, and the client
swallows recognition failures deliberately (see [03](03-ai-teaching-loop.md)).

## Common first-run problems

| Symptom | Cause |
|---|---|
| `yarn: command not found` | Use `corepack yarn` |
| `/health` shows all `false` | `.env.local` missing or in the wrong directory |
| Canvas loads, AI never responds | Backend not running, or keys absent |
| Backend edits have no effect | Express has no watcher — **restart it** |
| Process killed for "low memory" | Disk full, not RAM. See [13](13-troubleshooting.md) |

## Next

- [02-architecture-overview.md](02-architecture-overview.md) — how the pieces fit
- [13-troubleshooting.md](13-troubleshooting.md) — if any of the above went wrong
