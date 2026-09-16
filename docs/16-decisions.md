# 16 — Decision Records

Why things are the way they are. Each entry names the alternative that was rejected, so a
future change is an informed one rather than a rediscovery.

---

## ADR-001 — Model IDs live in exactly one file

**Date:** 2026-09-06 · **Status:** accepted

**Context.** Model ID strings were hardcoded in four files. They had drifted:
`chat.js` and `chat-simple.js` returned `model: "claude-sonnet-4"` to clients while
actually calling `claude-sonnet-4-20250514`. Clients were being told the wrong model.

**Decision.** Create `amatic-app/api/ai/models.js` exporting `TEACHING_MODEL` and
`CHAT_MODEL`. Additionally, the chat endpoints now report **`response.model`** — the model
the API actually served — falling back to the constant.

**Why `response.model` rather than just fixing the string.** A constant can drift again.
Reporting what the provider actually served makes the response self-describing and
impossible to desynchronise.

**Rejected.** Fixing the four literals in place — the same failure mode would recur.

---

## ADR-002 — `recognize` max_tokens raised 2000 → 8000

**Date:** 2026-09-07 · **Status:** accepted

**Context.** On Sonnet 5, omitting `thinking` runs **adaptive thinking**, and `max_tokens`
caps thinking **plus** output combined. The previous model ran thinking-*off* when omitted.

`recognize` returns the JSON `TeachingBrief` that drives the fast path, and **its caller
swallows failures silently** by design. A truncated brief would degrade teaching
invisibly.

**Decision.** Raise to 8000 and set `effort: "low"` explicitly.

**Rejected.** `thinking: { type: "disabled" }` to preserve exact prior behaviour. Current
guidance for a former thinking-off caller is to try adaptive at low effort first; disabling
thinking on these models also has known failure modes. Revisit once measured.

---

## ADR-003 — The stream parser is string- and escape-aware

**Date:** 2026-09-06 · **Status:** accepted · **Do not regress this**

**Context.** `master.js` extracts JSON objects from raw text deltas. The original scanner
counted `{` and `}` blindly.

That breaks on an **unbalanced** brace inside a string value:

- a stray `}` — e.g. *"type } to close the block"* — closes the object early. `JSON.parse`
  throws, and the empty `catch` discarded the event with no trace.
- a stray `{` is worse: `depth` never returns to 0, `end` stays `-1`, and the parser
  **stalls for the rest of the turn**, swallowing every remaining event.

Teaching text produces exactly those strings — LaTeX (`\frac{a}{b}`), code, set notation.

Measured against 12 cases fed in 7-character chunks: **old parser lost 7 events, new loses
0.** Balanced braces such as `{1, 2, 3}` happened to survive the old scan; unbalanced ones
did not.

**Decision.** `findObjectEnd()` tracks string literals and backslash escapes. The silent
`catch` became a `console.warn`. Prose between objects is dropped rather than accumulated,
and a `MAX_BUFFER_CHARS` guard prevents an unterminated object pinning memory.

**Rejected.** A streaming JSON parser library — for one well-known shape the added
dependency wasn't warranted. Reconsider if the event schema grows.

**Better long-term.** Structured outputs (`output_config.format`) or a tool call would
remove hand-parsing entirely. See [18](18-implementation-plan.md) Phase 3.

**Update 2026-09-07.** Phase 3.2 landed the tool-call path as `MASTER_OUTPUT_MODE=tools`
(`api/lib/master-events.js`), with this scanner still the default behind
`MASTER_OUTPUT_MODE=json`. Both produce identical normalized events and are unit-tested
side by side. The scanner is retired once a real session shows equal event counts in
`amatic_master_events_total` for both modes. Until then, do not regress this.

---

## ADR-004 — The 1M-context beta flags were removed, not relocated

**Date:** 2026-09-06 · **Status:** accepted

**Context.** `master.js` and `recognize.js` both passed
`betas: ["context-1m-2025-08-07"]` to `client.messages.create`.

Two independent problems: beta flags only take effect on `client.beta.messages.*`, so it
was a **no-op**; and the current model has a **1M context window as standard**, so the flag
is unnecessary anyway.

**Decision.** Delete both. The surrounding comment — which reasoned about "200K–1M input
costs 2×" — was also removed as unverified for this model.

**Rejected.** Moving the calls to `client.beta.messages.create` — that would add a beta
code path for a capability the model already has.

---

## ADR-005 — Dot keyframes live in a stylesheet, not a JSX `<style>`

**Date:** 2026-09-07 · **Status:** accepted

**Context.** When the mic status dot moved into `AppFooter`, its `@keyframes` were rendered
as a JSX `<style>` block in the same component. `AppFooter` re-renders on every
`jarvisPhase` change.

`LanguageList.test.tsx` then began failing — a test about **language switching**, with no
relationship to the dot. jsdom re-parsed the stylesheet on each render, adding ~350 ms and
pushing a `waitFor` past its 1 s timeout. It passed 3/3 in isolation and failed 2/2 in the
full suite, because the cost only mattered under parallel load.

**Decision.** `.jarvis-status-dot` and `@keyframes jarvis-pulse` moved to
`amatic-app/index.scss`. The component sets only `backgroundColor` per phase.

**Lesson worth keeping.** Style work at render time is cheap in a browser and expensive in
jsdom, and it surfaces as an unrelated test failure. "Passes in isolation" is not evidence
when the failure is load-dependent.

---

## ADR-006 — The status dot belongs in the footer flex row

**Date:** 2026-09-07 · **Status:** accepted

**Context.** The dot was `position: fixed; bottom: 16; right: 16`. The footer's own buttons
anchor to that **same** corner (`.App-menu_bottom` is `bottom: 1rem; padding: 0 1rem`), so
a 12px dot pinned there rendered *on top of* the 36px help button.

Measured: dot centre 22px from bottom; help button and encrypted icon both 34px.

**Decision.** Render it inside `AppFooter`'s existing flex row
(`gap: .5rem; align-items: center`). Flexbox aligns it, so it holds at any zoom or
viewport. Verified at 34px, matching its neighbours.

**Rejected.** Hardcoding `bottom: 28px; right: 102px`. It would have measured correctly and
then drifted the moment `EncryptedIcon` was hidden (it is conditional on
`isExcalidrawPlusSignedUser`).

---

## ADR-007 — The default sidebar removal touched the library, not just the app

**Date:** 2026-09-06 · **Status:** accepted

**Context.** Removing `<AppSidebar>` from `App.tsx` was not sufficient:
`withInternalFallback` makes `packages/amatic` render its **own** default sidebar when the
host app renders none.

**Decision.** Also remove the fallback `<DefaultSidebar>` and `DefaultSidebar.Trigger` from
`LayerUI.tsx`, the `renderSidebars` prop from `MobileMenu.tsx`, the Library/Search commands
from the command palette, and the global **Ctrl+F** binding.

**Why Ctrl+F mattered.** Leaving it bound would have swallowed the browser's native find
while doing nothing visible — worse than either keeping or removing the feature cleanly.

**Consequence.** The custom `Sidebar` API still works (all 11 custom-sidebar tests pass);
only the default sidebar is gone. Two tests asserting the default sidebar were removed as
testing deleted behaviour.

---

## ADR-008 — The SDK was upgraded, verified empirically

**Date:** 2026-09-07 · **Status:** accepted

**Context.** `@anthropic-ai/sdk` was at **0.71.2** — 53 minor versions behind. Its model
union stopped at an older Sonnet and `ThinkingConfigParam` had no `adaptive` member, so it
predated everything the migration relies on.

**Decision.** Upgrade to **0.124.0**.

**How it was validated.** No TypeScript upgrade guide is bundled with the tooling (only
Python has one), so rather than improvise a checklist, the four real usage patterns were
tested against a local sink: CJS `require` shape, `new Anthropic({apiKey})`, non-streaming
`create`, and `for await` streaming. All passed. The CJS require shape was the actual risk
— every `api/` file uses `const Anthropic = require(...)`, and a change there would have
broken every endpoint at startup.

`yarn.lock` moved 27 lines: the SDK plus three transitive deps for webhook verification.
No incidental upgrades. Full suite: no regressions against baseline.

---

## Open decisions

| Question | Status |
|---|---|
| Delete the ~7,100 lines of dead code? | Deferred — [14](14-dead-code.md) |
| Restore text chat, or stay canvas-only? | Open — [10](10-frontend-ui.md) |
| Migrate TTS to Kokoro? | Recommended, not done — [07](07-open-source-alternatives.md) |
| Free-tier providers, or stay paid? | **Blocked on measurement** — [06](06-costs.md) |
| Is Web Speech acceptable for children's audio? | **Needs a product decision** — [15](15-security-and-deployment.md) |
