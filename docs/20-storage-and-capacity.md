# 20 — Storage and Capacity

**Short answer:** yes, you need storage — but far less than the naive design implies, and
your existing empty **D: drive (313 GB)** covers development and a full pilot. **You do not
need to buy anything.**

All per-item sizes below are **engineering estimates**, not measurements — nothing has run
yet. The arithmetic is shown so you can substitute real numbers once Phase 0 produces them.

---

## 1. Development storage — today

| Item | Size | Notes |
|---|---|---|
| Repository (tracked) | **28 MB** | 1,196 files |
| `node_modules` | **~3 GB** | 74,378 files |
| `.git` after first commit | ~40–60 MB | history of a 28 MB tree |
| Build output (`build/`, `dist/`) | ~200–400 MB | regenerable |
| **Total working copy** | **~3.5 GB** | |

**Where it must live:** `D:\amatic-main`. Not C: (1.2% free) and **not inside OneDrive** —
74,378 dependency files under sync is a permanent drag on the machine and was the proximate
cause of the process kills ([13](13-troubleshooting.md)).

D: has 313 GB. This is a rounding error against it.

---

## 2. Runtime storage — per teaching turn

Derived from the code: 1 recognition thumbnail (384px JPEG q0.75), 1 master thumbnail
(512px JPEG q0.75), up to 3 generated images (400×300), one TTS clip per sentence, plus
metadata.

| Artefact | Est. size | Per turn | Subtotal |
|---|---|---|---|
| Recognition thumbnail | ~20 KB | 1 | 20 KB |
| Master thumbnail | ~35 KB | 1 | 35 KB |
| Generated images (**PNG**, as today) | ~350 KB | 3 | **1,050 KB** |
| TTS audio (~3 s mp3) | ~48 KB | ~6 | 290 KB |
| SQL rows + JSONB events | ~15 KB | 1 | 15 KB |
| **Total per turn** | | | **≈ 1.4 MB** |

**Images are 75% of it.** Everything else is noise by comparison. That single fact drives
every decision below.

---

## 3. Naive projection — store everything, PNG, per turn

Session lengths from the loop's own pacing (`PROACTIVE_COOLDOWN_MS = 15000` → ~4–8 turns
per 5 minutes; assume 6 turns / 5 min → ~36 turns per 30-minute session):

| Scope | Turns | Storage |
|---|---|---|
| One 5-min session | 6 | **8 MB** |
| One 30-min session | 36 | **50 MB** |
| 1 student/day (30 min) | 36 | 50 MB |
| **30 students/day** | 1,080 | **1.5 GB/day** |
| School month (20 days) | 21,600 | **~30 GB** |
| School year (200 days) | 216,000 | **~300 GB** |

300 GB/year for one class. That fills your D: drive in a year and does not scale to a
second class. **The naive design does not work.**

---

## 4. Optimised projection — three changes

### (a) Store images as WebP/JPEG, not PNG
Gemini returns PNG. Re-encode before storing: **350 KB → ~60 KB**, a ~6× reduction with no
visible loss for educational diagrams.

### (b) Don't store TTS per turn — cache by hash
Audio is fully regenerable from text. Cache keyed on `hash(text + voice + lang)` with an
LRU bound. Stock phrases ("Let's look at what you drew") are stored **once**, not per turn.
Bounded footprint: **~500 MB total**, not per-turn growth. This also cuts ElevenLabs spend
([06](06-costs.md)).

### (c) The diagram library — the decisive one
Store a vetted diagram **once per topic**, not once per turn
([18](18-implementation-plan.md) Phase 3.3).

School curricula are finite. ~500 topics × 3 diagrams × 60 KB ≈ **90 MB, one time.** After
that, image storage stops growing with usage entirely.

### Result

| Artefact | Optimised per turn |
|---|---|
| Thumbnails | 55 KB |
| Images | **~0** (library hit) |
| TTS | ~0 (hash cache) |
| Metadata | 15 KB |
| **Per turn** | **≈ 70 KB** |

| Scope | Storage |
|---|---|
| 30-min session | **2.5 MB** |
| 30 students/day | **76 MB/day** |
| School month | **~1.5 GB** |
| School year | **~15 GB** |
| + diagram library (one-off) | + 90 MB |
| + TTS cache (bounded) | + 500 MB |

**300 GB/year → 15 GB/year. A 20× reduction**, from three changes, none of which reduces
what the student sees.

---

## 5. Logs and metrics

Structured logging adds volume that is easy to underestimate.

| Item | Est. | Per turn |
|---|---|---|
| `llm_call` events (~5/turn) | ~2 KB each | 10 KB |
| `turn_complete` event | ~3 KB | 3 KB |
| HTTP access logs | ~1 KB | 6 KB |
| **Per turn** | | **~19 KB** |

30 students/day → 1,080 turns → **~20 MB/day**, **~600 MB/month**.

**Retention policy matters more than volume.** Recommended:

| Data | Retention | Why |
|---|---|---|
| Raw prompts / transcripts / drawings | **7–30 days** | children's data — minimise ([15](15-security-and-deployment.md)) |
| `llm_calls` (tokens, cost, latency) | 13 months | year-on-year cost analysis; no PII |
| Aggregated metrics | indefinite | tiny, and you want the trend |
| Golden-set artefacts | indefinite | this is your eval asset |

With 30-day retention on raw content, log storage is a **steady-state ~600 MB**, not
unbounded growth.

---

## 6. Do you need to buy storage?

**No — not for a long time.**

| Stage | Need | Covered by |
|---|---|---|
| Development | ~3.5 GB | D: drive (313 GB free) |
| Pilot, 1 class, 1 year | ~15–20 GB | D: drive, comfortably |
| 10 classes, 1 year | ~150–200 GB | D: drive, still fits |
| Beyond that | object storage | S3-class, ~$0.02/GB/month |

At 200 GB, cloud object storage costs roughly **$4/month** — trivial next to the provider
API bill, which is the real cost ([06](06-costs.md)).

**What you should do now:** nothing but move the project to D:. Postgres and object storage
arrive in Phase 4, and both start local.

**What would change this answer:** storing raw audio of every session (add ~10× for the
audio), keeping video, or dropping the diagram library and generating per turn (back to
300 GB/year/class).

---

## 7. Capacity limits that bind before storage does

Storage is the cheapest constraint here. These bind first:

| Constraint | Limit | Consequence |
|---|---|---|
| **Provider rate limits** | Google AI Studio free ≈ 1,500 req/day | ~20 five-minute sessions/day, total |
| **Cost per turn** | est. $0.03–$0.07 Claude + images | the real ceiling on scale |
| **Rate limiter** | 100 req/min per IP, broken behind proxy | one student can lock out a class ([15](15-security-and-deployment.md)) |
| **Local RAM/disk** | commit charge hit 97% | dev servers killed ([13](13-troubleshooting.md)) |

Storage does not appear until you are ten classes deep. **Spend the attention on cost per
turn and provider quotas.**

---

## 8. Checklist

**Now**
- [ ] Move the project to `D:\amatic-main`, out of OneDrive
- [ ] Pagefile to D: — fixes the process kills
- [ ] Nothing else. No storage purchase, no provisioning

**Phase 4 (persistence)**
- [ ] Local Postgres; measure a real session's row/artefact sizes
- [ ] Re-encode generated images to WebP **before** storing
- [ ] TTS hash cache with an LRU bound
- [ ] Retention policy implemented as a scheduled job, not a manual chore

**Before a second class**
- [ ] Build the diagram library — the 20× lever
- [ ] Move artefacts to object storage with lifecycle rules
- [ ] Alert on storage growth rate, not absolute size

## Next

- [19-target-architecture.md](19-target-architecture.md)
- [18-implementation-plan.md](18-implementation-plan.md)
