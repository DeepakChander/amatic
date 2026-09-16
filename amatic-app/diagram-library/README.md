# Diagram library

Human-vetted images served instead of live generation (docs/18 Phase 3.3).
Empty by default — every lookup misses and the worker generates as before.

## Adding a diagram

1. Generate or draw the image; a teacher checks it is pedagogically correct.
2. Save it here, e.g. `heart-anatomy.png` (PNG or JPEG, ≤ 1 MB, no text
   overlays — the canvas adds labels).
3. Add an entry to `index.json`. Keys are slugs (`lowercase-with-dashes`) of
   the recognised **topic**, optionally suffixed with `--<title-slug>` for a
   specific brief title. The first entry under a key is served.

   A request that carries a title matches **only** `topic--title`. It does not
   fall back to the bare topic entry — otherwise a turn asking for "Blood
   Flow", "Valves" and "Chambers" would get the same picture three times. The
   bare `topic` key serves requests with no title, which is what the master
   path sends.

```json
{
  "human-heart-anatomy": [
    {
      "file": "heart-anatomy.png",
      "title": "Heart Anatomy",
      "mimeType": "image/png",
      "approvedBy": "teacher@example.org",
      "approvedAt": "2026-09-07"
    }
  ],
  "human-heart-anatomy--blood-flow": [
    { "file": "heart-blood-flow.png", "title": "Blood Flow", "mimeType": "image/png" }
  ]
}
```

The index is re-read every 60 s, so no restart is needed. Topics come from
`/api/ai/recognize` (`teachingBrief.topic`); run a few real sessions, read
the `recognize_complete` log events, and seed the library from the topics
that actually appear. Matching is exact on the slug by design.

Serving from the library shows up as `image_call` events with
`outcome: "library"` and in `amatic_images_generated_total{outcome="library"}`.
Set `DIAGRAM_LIBRARY_DIR` to point somewhere else.
