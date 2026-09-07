# 09 — Canvas Integration

How AI-generated content gets onto the canvas without destroying the student's work.

This is the most carefully engineered part of the codebase and the part most likely to be
broken by a careless change.

---

## The core invariant: never overwrite the student

Two mechanisms enforce it.

### 1. The `ai-` id prefix

Every element the AI creates is tagged:

```ts
const imageEl = { ...newImageElement({...}), id: `ai-${randomId()}` };
```

That prefix is load-bearing in two places:

```ts
// recognition only ever looks at what the STUDENT drew
.filter(el => el.type === "freedraw" && !el.id.startsWith("ai-"))

// the thumbnail sent to master excludes AI content
.filter(el => !el.id.startsWith("ai-"))
```

**Without it the AI would recognise its own output and teach itself in a loop.** If you
add a new element type, tag it.

### 2. The zone grid

`canvas-monitor.ts` maintains a **4×6 grid** over the canvas, each cell classified:

| Marker | Meaning |
|---|---|
| `□` | empty — safe to place |
| `▪` | AI content |
| `■` | user content |

`extractSpatialContext()` returns this as `canvasZones`, and it is sent to `master` in the
system prompt so the model knows which regions are free. `findNextFreePosition()` then
picks a concrete scene coordinate:

```ts
const zoneToScene = (zone) => ({ /* zoom + scrollX/scrollY aware */ });
const belowY = allBounds.maxY + 40;          // prefer below everything existing
const belowCells = zoneMap.freeCells.filter(...);
```

Note the zone→scene conversion accounts for **current zoom and scroll**, so placement is
correct regardless of viewport state. That is the kind of detail that is invisible when
right and infuriating when wrong.

---

## Placement layout

Constants in `useCanvasJarvis.ts`:

| Constant | Value | Role |
|---|---|---|
| `IMAGE_WIDTH` / `IMAGE_HEIGHT` | 400 / 300 | generated image size |
| `PLACEMENT_PAD` | 20 | gap between images |
| `IMAGES_PER_ROW` | 2 | wrap after two |
| `TEXT_ROW_WIDTH` | 700 | text wraps past this |
| `TEXT_ROW_HEIGHT` | 50 | vertical step for text rows |
| `TEXT_COL_STEP` | 220 | horizontal step per text item |

Images flow left-to-right, wrapping after 2:

```ts
placeX += IMAGE_WIDTH + PLACEMENT_PAD;
if (++imagesInRow >= IMAGES_PER_ROW) { placeX = startX; placeY += IMAGE_HEIGHT + PLACEMENT_PAD; imagesInRow = 0; }
```

`next_topic` is special-cased — it re-reads `getAllElementsBounds()` and places at
`maxY + 30`, so the suggestion always lands below everything, including content added
during the turn.

---

## Fractional index integrity

Excalidraw orders elements with fractional indices. Inserting naively corrupts z-order, so
every insertion goes through:

```ts
function mergeWithValidIndices(existing, newEl) {
  const merged = [...existing, newEl];
  return syncInvalidIndicesImmutable(merged);
}
```

**Always use this helper.** Pushing an element straight into the array will produce
invalid indices and subtle rendering bugs.

## Undo-history hygiene

Every AI insertion uses:

```ts
api.updateScene({ elements: ..., captureUpdate: CaptureUpdateAction.NEVER });
```

`NEVER` keeps AI content out of the undo stack. A student pressing Ctrl+Z undoes *their
own* last stroke, not the tutor's diagram. Correct, and easy to get wrong.

---

## Thumbnail export

`exportThumbnail(api, elements, maxWidth)`:

```
exportToCanvas({ elements, appState, files })
  -> draw onto an offscreen canvas scaled to maxWidth
  -> toDataURL("image/jpeg", 0.75)
  -> strip the "data:image/jpeg;base64," prefix
```

| Call site | Width | Contents |
|---|---|---|
| `captureAndRecognize` | **384px** | the single latest freedraw element only |
| `startTeaching` | **512px** | the whole scene, `ai-` excluded |

Small sizes are deliberate — they keep vision token cost and upload latency down. Sonnet 5
supports up to 2576px on the long edge, so there is headroom if recognition accuracy turns
out to need it; expect roughly 3× the image tokens at the top end.

---

## Spatial memory

`lib/ai/spatial-memory.ts` (~432 lines), a singleton via `getSpatialMemory()`.

- `getConversationContext()` feeds `memoryContext` to `master`, so the tutor has continuity
  across turns
- Persists to browser storage (`import`/`export` methods)
- Tracks what was taught where

This is the mechanism that separates "a tutor" from "a stateless Q&A box". It is also
**entirely client-side** — clearing site data wipes the session, and nothing is recoverable
server-side for review or evaluation. See [18](18-implementation-plan.md) Phase 4.

---

## Rules for changing this code

1. **Tag new AI elements `ai-`** or recognition will feed on its own output.
2. **Insert via `mergeWithValidIndices`.**
3. **Use `CaptureUpdateAction.NEVER`** for AI content.
4. **Respect the abort signal** before every insertion — a stale turn must not draw.
5. **Exclude `ai-` elements from anything sent to a model.**
6. **Test at non-default zoom and scroll.** Placement bugs hide at 100%/origin.

## Weaknesses

- **No collision detection at insert time.** Placement is computed once at turn start; if
  the student draws into that space during the turn, content can overlap.
- **No viewport awareness.** Content may land off-screen with no indication, so the student
  never sees it.
- **The grid is fixed at 4×6** regardless of canvas size or zoom, so granularity degrades
  on large scenes.
- **No cleanup.** AI elements accumulate forever; there is no "clear AI content" action.

## Next

- [10-frontend-ui.md](10-frontend-ui.md)
- [03-ai-teaching-loop.md](03-ai-teaching-loop.md)
