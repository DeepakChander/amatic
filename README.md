# Amatic

**An AI teaching canvas.** A student draws on an infinite whiteboard; an AI tutor watches,
recognises what they drew, and teaches it back with generated diagrams, on-canvas labels
and spoken narration.

Built on [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT), with an AI layer
added on top.

> **Status: early / internal.** The canvas works standalone, but the AI features need
> three provider API keys before they do anything. See [Setup](#setup).

---

## What the AI actually does

Not a chatbot — an always-on loop that reacts to drawing:

```
Student draws  ->  background vision recognises the drawing  ->  brief cached
                                    |
                    student pauses 3 seconds
                                    |
        streamed teaching turn: narration + generated images + canvas labels
```

- **Drawing recognition** — the last stroke is exported and read by Claude while the
  student is still drawing, so teaching can start the moment they pause.
- **Generated visuals** — Gemini renders educational images, placed into free canvas
  space so they never cover the student's work.
- **Spoken narration** — ElevenLabs text-to-speech, queued sentence by sentence.
- **Voice input** — the browser's Web Speech API, always listening when the mic is on.
  The green dot in the footer shows the state.

Full details, including the constants worth tuning:
**[`docs/03-ai-teaching-loop.md`](docs/03-ai-teaching-loop.md)**, and the full
documentation index at **[`docs/README.md`](docs/README.md)**.

## Canvas features

Inherited from Excalidraw and fully working without any API keys:

- Infinite canvas with a hand-drawn style
- Rectangle, circle, diamond, arrow, line, free-draw, eraser, text, images
- Arrow binding and labelled arrows, undo/redo, zoom and pan
- Dark mode, localisation (i18n), PWA / offline support
- Export to PNG, SVG and clipboard
- Real-time collaboration with end-to-end encryption
- Local-first autosave to the browser

---

## Setup

### 1. Install

```bash
yarn install
# if yarn is not on your PATH:
corepack yarn install
```

### 2. Add API keys

The AI needs `.env.local` **at the repository root** — a sibling of `package.json`, not
inside `amatic-app/`. It is not committed and not generated; create it:

```bash
ANTHROPIC_API_KEY=sk-ant-...      # teaching brain + drawing recognition
GOOGLE_AI_API_KEY=...             # image generation
ELEVENLABS_API_KEY=...            # voice output
```

Without this file the canvas still works, but every AI feature fails silently.

### 3. Run

```bash
yarn start
```

That starts two processes: the Vite frontend on **:3000** and the Express AI backend on
**:3001** (Vite proxies `/api/*` to it). If `yarn` is unavailable, run them directly:

```bash
cd amatic-app && node server.js                        # backend
cd amatic-app && node ../node_modules/vite/bin/vite.js # frontend
```

### 4. Check the keys loaded

```bash
curl http://localhost:3001/health
# "models": { "claude": true, "gemini": true, "elevenlabs": true }
```

Any `false` means that key is missing.

---

## Repository layout

| Path | What it is |
|---|---|
| `amatic-app/` | The application — canvas UI, AI hook, Express backend |
| `amatic-app/api/` | AI and voice endpoints (Node, CommonJS) |
| `amatic-app/hooks/useCanvasJarvis.ts` | The teaching loop |
| `packages/amatic/` | The editor library (Excalidraw fork) |
| `packages/` | `common`, `element`, `math`, `utils` |
| `docs/` | Amatic documentation |
| `dev-docs/` | Inherited Excalidraw docs site, not Amatic's |
| `examples/` | Integration examples (inherited) |

## Development

```bash
yarn test:typecheck  # TypeScript — currently clean
yarn test            # Vitest
yarn fix             # Auto-fix formatting and lint
```

See **[`CLAUDE.md`](CLAUDE.md)** for working notes, and
**[`docs/README.md`](docs/README.md)** for the full documentation set (18 documents).

## Known limitations

Worth knowing before you file a bug:

- **The test suite has ~138 pre-existing failures across 16 files** on untouched code.
  Compare against that baseline rather than expecting green. `tsc --noEmit` is clean.
- **`yarn test:code` (eslint) already fails** on unused imports in `App.tsx` and
  `AppMainMenu.tsx`.
- **No CI yet.** Nothing runs on push. Version control exists (`main` tracking
  `origin` at https://github.com/DeepakChander/amatic), but there are no automated checks.
- **There is no text-chat UI.** The canvas teaching loop is the only live AI path;
  `/api/ai/chat` exists but nothing calls it.
- **`api/voice/speech-to-text.js` is a stub** that returns an empty transcript. Speech
  recognition happens in the browser instead.
- **Roughly 7,100 lines under `amatic-app/lib/` are unreachable dead code**, including an
  unused planning layer. Don't read it as the architecture.
- **The AI endpoints have no authentication and a 100 req/min per-IP rate limit.** Fine
  for local development; not safe to deploy as-is.

## Credits and licence

Amatic is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw), which does
the hard work of the canvas, rendering, collaboration and export. Enormous thanks to that
project and its contributors.

Released under the MIT licence — see [`LICENSE`](LICENSE), which retains the original
Excalidraw copyright.
