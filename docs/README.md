# Amatic Documentation

Last verified against the code: **2026-09-07**.

Amatic is an **AI teaching canvas** — a student draws on an infinite whiteboard, an AI
tutor recognises the drawing and teaches it back with spoken narration, on-canvas labels
and generated diagrams. It is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw)
with an AI layer on top.

> **Current state:** the whiteboard works. The AI layer is code-complete but **has never
> executed** — no API keys are configured. Read [01-getting-started](01-getting-started.md)
> first, then [17-roadmap](17-roadmap.md) for an honest assessment of what is and isn't done.

---

## Reading order

**If you are new here, read these three in order:**

1. **[01-getting-started.md](01-getting-started.md)** — get it running (keys, ports, verify)
2. **[02-architecture-overview.md](02-architecture-overview.md)** — the two processes and how a request flows
3. **[03-ai-teaching-loop.md](03-ai-teaching-loop.md)** — what the AI actually does

## Reference

| Doc | Covers |
|---|---|
| [04-api-reference.md](04-api-reference.md) | Every endpoint: request, response, errors |
| [05-models-and-providers.md](05-models-and-providers.md) | `models.js`, Sonnet 5 rules, provider setup |
| [06-costs.md](06-costs.md) | Per-turn cost model, session estimates, how to measure |
| [07-open-source-alternatives.md](07-open-source-alternatives.md) | Free-tier and local options, hardware limits |
| [08-voice-pipeline.md](08-voice-pipeline.md) | TTS and STT, the Kokoro migration path |
| [09-canvas-integration.md](09-canvas-integration.md) | Zone grid, placement, spatial memory |
| [10-frontend-ui.md](10-frontend-ui.md) | App shell, footer status dot, what was removed |

## Working on it

| Doc | Covers |
|---|---|
| [11-development-workflow.md](11-development-workflow.md) | Monorepo, aliases, commands, restart rules |
| [12-testing.md](12-testing.md) | The 138-failure baseline and how to read it |
| [13-troubleshooting.md](13-troubleshooting.md) | Disk/memory, OneDrive, `yarn` PATH, common errors |
| [14-dead-code.md](14-dead-code.md) | ~7,100 unreachable lines and what must never be deleted |

## Planning

| Doc | Covers |
|---|---|
| [15-security-and-deployment.md](15-security-and-deployment.md) | Auth, rate limiting, key handling — **read before deploying** |
| [16-decisions.md](16-decisions.md) | Why things are the way they are (ADRs) |
| [17-roadmap.md](17-roadmap.md) | Completion assessment, demo readiness, priorities |
| [18-implementation-plan.md](18-implementation-plan.md) | The production build-out plan, phased |

---

## The five things that will bite you

Every one of these is documented in detail elsewhere, but you should know them now:

1. **`.env.local` must exist at the repo root.** Without it every AI call fails at the key
   check. See [01](01-getting-started.md).
2. **This working copy is not a git repository.** No undo. Back up before editing.
   See [13](13-troubleshooting.md).
3. **The test suite has ~138 pre-existing failures.** A red suite is the normal state.
   See [12](12-testing.md).
4. **~7,100 lines under `amatic-app/lib/` are dead code** describing an architecture that
   does not run. See [14](14-dead-code.md).
5. **The AI endpoints have no authentication.** Do not deploy as-is.
   See [15](15-security-and-deployment.md).
