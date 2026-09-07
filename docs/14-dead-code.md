# 14 — Dead Code

## Summary

**38 files, ~7,119 lines under `amatic-app/` are unreachable** from `index.tsx`,
`server.js`, or any test file. They are still on disk, deliberately, pending a decision.

**Why this matters more than tidiness:** several of these files describe a *more elaborate
architecture than the one that runs*. `lib/ai/master-planner.ts` looks like the
orchestrator; it is not. A new engineer reading `lib/ai/` will build a wrong mental model
of the system. That is the real cost.

## Method

The list was produced by walking a transitive import graph — **static imports,
`export … from`, dynamic `import()`, and `require()`** — from three sets of roots:

- `amatic-app/index.tsx` (Vite entry)
- `amatic-app/server.js` (backend entry)
- every file under `amatic-app/tests/`

Tests are roots on purpose: deleting something a test imports breaks the suite.

**A naive name-grep is not sufficient.** An earlier grep-based pass got this wrong in both
directions — it reported `lib/utils.ts` as live (it isn't; `App.tsx` imports no `@/` paths
at all) while missing `AmaticToolbar.tsx`, the `components/ui/*` primitives, `debug.ts`,
`types/master-plan.ts` and `stores/canvas-store.ts` entirely. Dynamic imports are the
specific thing grep misses: `master-planner.ts`, `content-type-classifier.ts`,
`detailed-context-generator.ts` and `visual-task-planner.ts` all use
`await import("…")`.

## ⚠️ Four files that look orphaned but must NEVER be deleted

The graph flags these because nothing imports them. Deleting any one breaks the build:

| File | Lines | Why it's essential |
|---|---|---|
| `amatic-app/vite.config.mts` | 311 | **the build config itself** |
| `amatic-app/vite-env.d.ts` | 45 | ambient types, pulled in via tsconfig `include` |
| `amatic-app/global.d.ts` | 6 | ambient types |
| `amatic-app/scripts/generate-workers.js` | 79 | run by the `generate:workers` npm script |

Any future reachability pass must exclude build config, ambient `.d.ts` declarations, and
npm-script entry points.

## The unreachable set

### The AI planning layer — ~2,700 lines

The largest and most misleading block. `master-planner.ts` is the orphan root; everything
below it is reachable only *from* it.

| File | Lines |
|---|---|
| `lib/ai/detailed-context-generator.ts` | 628 |
| `lib/ai/master-planner.ts` | 488 |
| `lib/ai/visual-task-planner.ts` | 385 |
| `lib/ai/content-type-classifier.ts` | 394 |
| `lib/ai/anthropic-service.ts` | 136 |
| `lib/ai/visual-type-classifier.ts` | 63 |
| `lib/visual/query-analyzer.ts` | 64 |
| `types/master-plan.ts` | 254 |
| `lib/image-generation/prompt-builder.ts` | 131 |
| `lib/image-generation/model-selector.ts` | 54 |

The live orchestration is `hooks/useCanvasJarvis.ts`. This layer appears to be an earlier,
more ambitious design that was superseded and never removed.

### Duplicate provider clients — ~919 lines

| File | Lines | Note |
|---|---|---|
| `lib/ai/anthropic-client.ts` | 648 | the live code uses the SDK directly in `api/ai/*.js` |
| `lib/ai/gemini-client.ts` | 131 | ditto |
| `lib/voice/elevenlabs-client.ts` | 155 | ditto |

⚠️ These still reference **old model IDs**. They were excluded from the Sonnet 5 migration
because they never run — but anyone reading them will get the wrong answer about which
models this project uses. `api/ai/models.js` is the only source of truth
([05](05-models-and-providers.md)).

### Superseded worker coordination — 476 lines

`lib/workers/worker-coordinator.ts` (293) and `worker-status-tracker.ts` (183). Replaced by
the inline `dispatchWorker` closure inside `useCanvasJarvis`.

### Orphaned voice — 797 lines

`lib/voice/use-realtime-voice.ts` (310), `lib/voice/voice-types.ts` (385),
`hooks/use-voice-settings.ts` (102).

**Note:** the last two became orphaned when the chat sidebar was removed — they were
imported by `AgenticChat`/`VoiceEnhancedChat`. The other ~4,850 lines were already dead
before that.

### Orphaned canvas helpers — 264 lines

`lib/canvas/activity-stream.ts` (85), `gesture-detector.ts` (108), `spatial-context.ts` (71),
plus `lib/ai/spatial-context.ts` (383), `agentic-service.ts` (82), `config.ts` (76).

### Orphaned UI — ~1,375 lines

| File | Lines |
|---|---|
| `components/AmaticToolbar.tsx` | **920** |
| `components/ui/*` (8 shadcn primitives) | 317 |
| `debug.ts` | 135 |
| `stores/canvas-store.ts` | 75 |
| `lib/utils.ts` / `lib/logger.ts` | 79 |
| `bug-issue-template.js` | 11 |

The mic button in the toolbar comes from `packages/amatic/components/MicButton.tsx`, not
from `AmaticToolbar`.

## Recommendation

**Delete the provider clients and the planning layer first** (~3,600 lines). They are the
actively misleading part — they describe model choices and an orchestration design that do
not exist.

`AmaticToolbar.tsx` (920 lines) and `components/ui/*` are a separate judgement: they look
like intentional, unfinished work rather than superseded work. Keep them if you plan to
wire them up; delete them if not.

**Git now exists**, so deletion is cheap to reverse — do it on a branch, and `git revert`
if the reachability analysis missed an edge. That removes the main argument for deferring
this.

## Regenerating the list

Walk the import graph as described in [Method](#method). Key implementation notes:

- Resolve `@/` → `amatic-app/`; treat bare and `@amatic/*` specifiers as out of scope
- Try extensions `.ts .tsx .js .jsx .mts .mjs` and `index.*` for directories
- Match all four import forms, not just static `import`
- Exclude the four must-keep files above
- Include `tests/**` as roots

## Next

- [16-decisions.md](16-decisions.md)
- [17-roadmap.md](17-roadmap.md)
