# 10 — Frontend and UI

## The app shell

`amatic-app/index.tsx` → `amatic-app/App.tsx` → `<Excalidraw>` from `packages/amatic`.

`App.tsx` is large and does several jobs: collaboration wiring, export handlers, share
dialog, debug canvas, command palette, and mounting the Jarvis hook:

```tsx
const micEnabled = useMicEnabled();
const { jarvisPhase, currentTranscript } = useCanvasJarvis(excalidrawAPI ?? null, micEnabled);
```

Microphone permission is requested only while the mic is on — a muted mic never prompts,
which is the right behaviour for a product used by children.

## The status dot

`amatic-app/components/AppFooter.tsx`. This is how a student knows the mic is live.

| Phase | Colour | Meaning |
|---|---|---|
| `idle` | not rendered | mic off |
| `watching` | green `#22c55e` | listening, watching the canvas |
| `listening` | orange `#f97316` | processing speech |
| `teaching` | blue `#3b82f6` | explaining |

Rendered **inside the footer's flex row** (`display: flex; gap: .5rem; align-items: center`),
alongside `EncryptedIcon` and the help button. That matters: it means flexbox aligns it, so
it stays on the footer baseline at any zoom or viewport.

It previously sat at `position: fixed; bottom: 16; right: 16` — the same corner the footer
buttons anchor to — and rendered *on top of* the help button, 12px below the row's centre
line. Measured centre-from-bottom went from 22px (wrong) to 34px (matching the help button
and encrypted icon exactly).

### Accessibility

```tsx
role="status"
aria-label="Microphone is on — Jarvis is watching the canvas"
title={...}
```

Without these the mic state is **colour-only**, which fails for colour-blind and screen-reader
users. For a live-microphone indicator that is a meaningful gap, not a nicety.

### Styling location

`.jarvis-status-dot` and `@keyframes jarvis-pulse` live in **`amatic-app/index.scss`**, not
in the component.

**This is deliberate — do not move them back.** The keyframes were briefly rendered as a
JSX `<style>` block inside `AppFooter`, which re-renders on every phase change. jsdom
re-parsed that stylesheet on each render and added ~350 ms to `LanguageList.test.tsx`,
pushing its `waitFor` past the 1 s timeout. Cheap in a browser, expensive in tests, and it
surfaced as a mysterious unrelated test failure. See [16](16-decisions.md) ADR-005.

## The transcript bubble

Rendered from `App.tsx` when `currentTranscript` is non-empty: `position: fixed`,
`bottom: 64`, `right: 16`, `pointerEvents: none`. Sits above the footer row (36px tall at
`bottom: 16`) so it clears the icons rather than covering them.

## What was removed

**The right sidebar is gone.** `AppSidebar` used to render Excalidraw's `DefaultSidebar`
with two tabs — `comments` (hosting `AgenticChat`, the AI chat panel) and `presentation`.

Removing it required more than deleting the component, because `withInternalFallback` means
the library renders its **own** default sidebar when the host app doesn't:

| File | Change |
|---|---|
| `App.tsx` | `<AppSidebar>` mount and import removed |
| `packages/amatic/components/LayerUI.tsx` | fallback `<DefaultSidebar>`, `DefaultSidebar.Trigger`, and the trigger tunnel outlet removed |
| `packages/amatic/components/MobileMenu.tsx` | `renderSidebars` prop and call removed |
| `packages/amatic/components/CommandPalette/CommandPalette.tsx` | "Library" and "Search" commands removed |
| `packages/amatic/actions/actionToggleSearchMenu.ts` | global **Ctrl+F** binding removed |
| `amatic-app/components/AppMainMenu.tsx` | "Find on canvas" item removed |

The Ctrl+F removal mattered: leaving it bound would have swallowed the browser's native
find while doing nothing visible.

### Consequences

- **No text-chat UI.** `/api/ai/chat` and `/api/voice/chat-simple` have no caller.
- **No canvas search.** Ctrl+F is free again.
- **No shape library UI.**
- The custom `Sidebar` API still works — all 11 custom-sidebar tests pass. Only the
  *default* sidebar is gone.

`AgenticChat` and `VoiceEnhancedChat` were deleted from the tree. If you want chat back,
they must be rewritten or restored from a backup; mounting them as a standalone panel does
not require restoring the whole sidebar.

## Orphaned UI

Unreachable from `index.tsx` ([14](14-dead-code.md)):

- `components/AmaticToolbar.tsx` — **~920 lines**, nothing imports it
- `components/ui/*` — 8 shadcn-style primitives (button, card, badge, input, label,
  scroll-area, switch, textarea), orphaned when the chat panel went
- `debug.ts` — exports `class Debug`, zero references

The mic button visible in the top toolbar comes from
`packages/amatic/components/MicButton.tsx` (the library), **not** from `AmaticToolbar`.

## Weaknesses

- **No AI error surface.** `master.js` emits `{"type":"error"}` and the client ignores it.
  A keyless or failing backend produces total silence — the student cannot tell the
  difference between "thinking" and "broken".
- **No loading state during the wait.** After the 3 s debounce, adaptive thinking adds
  latency before the first word. Nothing indicates work is happening beyond the dot turning
  blue.
- **No way to interrupt deliberately.** A student can only interrupt by drawing again.
  There is no stop button.
- **No transcript history view.** `currentTranscript` shows the live utterance only.

## Next

- [03-ai-teaching-loop.md](03-ai-teaching-loop.md)
- [17-roadmap.md](17-roadmap.md)
