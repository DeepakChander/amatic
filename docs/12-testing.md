# 12 — Testing

## The baseline: a red suite is normal here

**Measured 2026-09-06 on untouched code**, before any of this project's changes:

```
Test Files   16 failed | 72 passed  (88)
Tests       138 failed | 889 passed | 46 skipped | 1 todo  (1074)
```

**138 tests fail on code nobody has touched.** Anyone running `yarn test` for the first
time will assume they broke something. They didn't.

`tsc --noEmit`, by contrast, is **clean at 0 errors**. `yarn test:code` (eslint
`--max-warnings=0`) **already fails** on unused imports in `App.tsx` and `AppMainMenu.tsx`.

### The 16 failing files

```
amatic-app/tests/MobileMenu.test.tsx
packages/amatic/tests/App.test.tsx
packages/amatic/tests/contextmenu.test.tsx          (17/17 fail)
packages/amatic/tests/elementLocking.test.tsx
packages/amatic/tests/excalidraw.test.tsx
packages/amatic/tests/history.test.tsx              (36/66 fail)
packages/amatic/tests/regressionTests.test.tsx
packages/amatic/tests/scene/export.test.ts
packages/amatic/tests/selection.test.tsx            (14/15 fail)
packages/amatic/tests/tool.test.tsx
packages/amatic/wysiwyg/textWysiwyg.test.tsx
packages/element/tests/cropElement.test.tsx
packages/element/tests/duplicate.test.tsx
packages/element/tests/frame.test.tsx
packages/element/tests/linearElementEditor.test.tsx (32/42 fail)
packages/utils/tests/export.test.ts
```

Nobody has triaged these. They are mostly in the inherited Excalidraw layer.

## How to tell if you broke something

**Do not read the raw count.** Diff the *failing-file set* against the baseline:

```bash
corepack yarn test --no-color > after.txt 2>&1
grep -oE "FAIL +[^ ]+\.(test|spec)\.[a-z]+" after.txt | awk '{print $2}' | sort -u > files-after.txt
comm -13 files-baseline.txt files-after.txt   # anything printed = you broke it
```

Keep `files-baseline.txt` in the repo so this is a one-liner.

## Current state after this project's changes

```
Test Files   16 failed | 71 passed  (87)
Tests       138 failed | 883 passed | 46 skipped | 1 todo  (1068)
```

Same 16 files. **Zero regressions.** The 6-test drop is deliberate removals:

| Removed | Why |
|---|---|
| `search.test.tsx` (5 tests) | Canvas search was removed with the sidebar |
| `library.test.tsx > library menu > should load library from file picker` | Queried `.sidebar-trigger`, which no longer exists |

## Two failures worth understanding

Both were **caused** during this work and then fixed. They illustrate how this suite
misleads.

### 1. Sequencing, not logic

`Sidebar.test.tsx > should toggle sidebar using excalidrawAPI.toggleSidebar()` failed after
an assertion was removed from the middle of it. The removed step (toggling the library
sidebar) had *closed* the custom sidebar as a side effect; without it the sidebar was
already open, so the next `toggleSidebar` closed rather than opened it.

**Lesson: long sequential tests carry hidden state.** Deleting a step in the middle changes
the meaning of every step after it.

### 2. A performance change surfacing as an unrelated failure

`LanguageList.test.tsx > rerenders UI on language change` began failing after the mic status
dot moved into `AppFooter`. Nothing about language handling changed.

Cause: the dot's `@keyframes` were rendered as a JSX `<style>` block inside a component
that re-renders on every phase change. jsdom re-parsed that stylesheet on each render,
adding ~350 ms and pushing the German-locale `waitFor` past its 1 s timeout.

It **passed 3/3 in isolation** and failed 2/2 in the full suite — because the cost only
mattered under parallel load.

**Lessons:**
- "Passes in isolation" is not evidence when the failure is load-dependent.
- A test failure in one area can be caused by a performance regression in a completely
  different one.
- Fix: move keyframes to a real stylesheet ([16](16-decisions.md) ADR-005).

## Running tests

```bash
corepack yarn test                                          # everything (~2.5 min)
node node_modules/vitest/vitest.mjs run path/to/file.test.tsx
node node_modules/vitest/vitest.mjs run --reporter=verbose   # per-test results
node node_modules/vitest/vitest.mjs run -t "test name"       # by name
```

⚠️ **Do not run the full suite while the dev servers are up on a constrained machine.**
Vitest fans out worker processes across 87 files; combined with Vite, `tsc` and a browser
this exhausted memory and the OS killed the dev servers repeatedly. Stop the servers first.

⚠️ **Don't pipe the full run through `tail`** — output buffers until the process exits, so
you lose all failure detail. Redirect to a file.

## Snapshots

22 `.snap` files. Sidebar references inside them are appState fields
(`"openSidebar": null`, `"defaultSidebarDockedPreference": false`), **not DOM markup** —
which is why removing the sidebar UI did not invalidate them. Worth knowing before assuming
a UI change will require `test:update`.

## What's missing

- **No test baseline file in the repo.** Every developer rediscovers the 138.
- **No triage.** Nobody knows whether those 138 represent real bugs.
- **No tests for the AI layer at all.** `useCanvasJarvis` (~800 lines), `canvas-monitor`,
  `spatial-memory` and every `api/` endpoint are untested. The most valuable and most
  fragile code has zero coverage.
- **No CI.** Git exists but nothing runs on push. A GitHub Actions workflow gating
  `test:typecheck` plus a failing-file diff against the baseline is the obvious first step.
- **No evals.** For an LLM product this is the real gap: there is no way to tell whether a
  prompt change made the teaching better or worse. See [18](18-implementation-plan.md)
  Phase 5.

## Next

- [13-troubleshooting.md](13-troubleshooting.md)
- [18-implementation-plan.md](18-implementation-plan.md)
