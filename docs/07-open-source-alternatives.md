# 07 — Open-Source and Free-Tier Alternatives

Researched 2026-09-07. Rate limits and pricing change constantly — re-verify before
designing around any number here.

## The hardware constraint

Measured on the current development machine:

```
CPU:  AMD Ryzen 7 5800HS, 8 cores / 16 threads
GPU:  AMD Radeon integrated (Vega, in-APU) — 512 MB shared
      No discrete GPU. No NVIDIA. No CUDA.
RAM:  15.7 GB
```

512 MB of shared integrated memory is, for inference purposes, **no GPU at all**. This one
fact determines every recommendation below.

## Verdict by capability

| Capability | Current | Local open source? | Free hosted? |
|---|---|---|---|
| **TTS** | ElevenLabs | ✅ **yes — Kokoro-82M** | n/a |
| **STT** | Web Speech API | ✅ already free in-browser | n/a |
| **Vision + reasoning** | Claude Sonnet 5 | ❌ needs 6–24 GB VRAM | ⚠️ yes, with hard caps |
| **Image generation** | Gemini | ❌ needs 4–33 GB VRAM | ❌ not at this volume |

---

## 1. TTS — the one clear win

**[Kokoro-82M](https://localaimaster.com/blog/kokoro-tts-local-setup)** is the credible
replacement for ElevenLabs here:

- 82M parameters, **Apache 2.0**
- ~2–3 GB, **runs faster than real time on CPU alone**
- 54 voices, 8 languages
- Described in 2026 surveys as the best default open-source TTS

Alternatives on the quality/speed curve:

| Model | Trade-off |
|---|---|
| **Piper** | Fastest, smallest, runs on edge devices — but the most robotic |
| **Kokoro** | Middle: surprisingly natural from a tiny model. **Recommended** |
| **XTTS v2** | Voice cloning from ~6s of audio, but higher latency and memory. The company behind it shut down in early 2024; community-maintained |
| **Chatterbox** | Reported to beat ElevenLabs on some preference tests — worth evaluating |

**Why this fits Amatic specifically:** narration is short sentences played sequentially
([03](03-ai-teaching-loop.md)). Kokoro on CPU comfortably keeps ahead of playback. This
migration removes an entire paid provider with no quality cliff.

**Implementation sketch:** run Kokoro behind a small local HTTP service, then point
`api/voice/text-to-speech.js` at it. The endpoint contract (text in, audio bytes out) does
not change, so the client needs no edits. Keep the ElevenLabs path behind a
`TTS_PROVIDER` env flag so it can be switched back.

## 2. STT — already free

The browser Web Speech API costs nothing and never hit a paid provider. `speech-to-text.js`
is a stub. **No change needed.**

Trade-off to be aware of: Web Speech quality varies by browser and requires network in
Chrome. If you later need offline or consistent STT, **Whisper** variants are the open
option — but `whisper.cpp` on this CPU will not keep up with live speech.

## 3. Vision + reasoning — local is not viable

| Model | Requirement | On 512 MB |
|---|---|---|
| Qwen3-VL flagship | ~471 GB weights | ❌ |
| Qwen 3.6-27B dense | ~17 GB VRAM | ❌ |
| GLM-4.5V / GLM-4.1V-9B | GPU class | ❌ |
| Llama 3.2 Vision 11B | ~7.8 GB, consumer GPU | ❌ |
| MiniCPM-V 4.5 (8B) / LLaVA 1.6 7B | 6–8 GB VRAM (the entry tier) | ❌ |

Even the smallest recommended 2026 tier assumes 6–8 GB VRAM. CPU-only inference of a 7B
vision model lands around 2–5 tokens/sec — call it **30–120 seconds per turn**.

**`IDLE_DEBOUNCE_MS` is 3 seconds.** The student pauses and expects teaching. A minute of
silence is not a degraded experience, it is a broken one.

### Free hosted tiers instead

| Provider | Free allowance | Vision? | Fit |
|---|---|---|---|
| **Google AI Studio** (Gemini 2.5 Flash) | ~1,500 req/day, 1M tok/min, no card | ✅ | **Best fit** |
| **Groq** (Llama) | ~14,400 req/day, ~6,000 tok/min | text only | Good for `master`, not `recognize` |
| **Cerebras / Mistral** | permanent free tiers | varies | Evaluate |
| **OpenRouter** | 50 req/day (1,000 after $10 credit) | 25+ free models | ❌ unusable free |

**Do the arithmetic against this app.** One turn = 2 LLM calls. So:

- Google AI Studio, 1,500/day → **~125 turns/day → ~20 five-minute sessions**
- Groq, 14,400/day → plenty for text, but cannot do the vision step
- OpenRouter free, 50/day → **4 turns per day**. Not a product.

Google AI Studio is also already in your stack for images, so it means one provider and
one key.

**The honest cost of switching:** `master.js` asks the model to stream *typed JSON events*
mid-narration. Reliable structured output under streaming is precisely what smaller free
models are worst at. Expect malformed events. Your parser now logs them
([16](16-decisions.md) ADR-003) rather than dropping them silently, so you will at least
see the failure rate.

## 4. Image generation — the hard wall

| Model | VRAM | On 512 MB |
|---|---|---|
| FLUX.1 Dev FP16 | ~33 GB (13 GB at FP8) | ❌ |
| FLUX.2 klein 4B | ~13 GB | ❌ |
| SD 3.5 Large | 16–24 GB | ❌ |
| SDXL | 10–12 GB | ❌ |
| SD 1.5 | 4 GB — the absolute floor | ❌ |

SD 1.5 is the floor and you have an eighth of it. On CPU, SD 1.5 runs **2–5 minutes per
image**; the app dispatches 3 per turn.

**There is no free tier that sustains 18 images per five-minute session.** This is not a
configuration problem, it is an economics problem.

Realistic options, in order of how much I'd recommend them:

1. **Cut to 1 image per turn.** ~67% off the likely-largest cost line, keeps the feature.
2. **Make images opt-in** — a "show me a diagram" button rather than automatic.
3. **Pre-generate and cache** a library of diagrams for common topics (Newton's laws,
   photosynthesis, the water cycle). Most school curricula are finite. **This is the
   idea I would actually build** — it turns a per-turn variable cost into a one-time cost,
   and lets a human vet the diagrams for accuracy.
4. **Drop generated images**; rely on `canvas_text` labels plus narration.

On (4): generated diagrams for education are frequently *subtly wrong* in ways a student
won't catch. Accurate on-canvas labels plus a good spoken explanation may well be the
better product, not the compromise.

---

## Recommended target architecture (zero paid providers)

```
Vision + reasoning  ->  Google AI Studio free tier (Gemini 2.5 Flash)
TTS                 ->  Kokoro-82M, local, CPU
STT                 ->  Web Speech API (unchanged)
Images              ->  pre-generated cached library, or dropped
```

Ceiling: **~20 five-minute sessions per day.** Enough to develop against, demo, and run a
small pilot. Not enough for a classroom.

### Status — implemented 2026-09-16

All four are now switchable, and the default configuration costs nothing:

| Capability | Flag | Default | Notes |
|---|---|---|---|
| Vision + reasoning | `LLM_PROVIDER` | `ollama` | `ollama` (local) · `gemini` (free tier) · `anthropic` (paid) |
| TTS | `TTS_PROVIDER` | `kokoro` | local CPU, no key |
| STT | — | Web Speech | unchanged, already free |
| Images | `GOOGLE_AI_API_KEY` | library-only when unset | vetted diagrams; clean skip on a miss |

`api/lib/llm.js` holds the three teaching-brain backends behind one interface
(a stream of text/tool/usage items), so routes do not branch per provider.
`docker-compose.ollama.yml` runs the local option; `/readyz` reports which
provider serves each capability and how to start one that is down.

**A third option the table above did not consider: fully local via Ollama.**
docs/07 originally ruled local vision out on this hardware, and that reasoning
still stands — see the measurement note below. It is implemented anyway so the
tradeoff can be judged on a real number rather than an estimate. Small 3B
models (`qwen2.5vl:3b` for vision, `qwen2.5:3b` for text) are the ceiling here.

Structured output is the one place the local path needed help: `recognize`
now sends a JSON **schema** as an output constraint rather than only asking
for JSON in the prompt, which is the difference between a small model
usually complying and reliably complying.

## What I would actually do first

Before migrating anything: **add prompt caching and measure real costs**
([06](06-costs.md)). Claude at an estimated $0.03–$0.07 per turn may be cheaper than the
quality loss is worth — but nobody knows yet, because nothing has been measured. Migrating
to dodge an unmeasured cost is optimising blind.

**Sources**
- [Multimodal AI: Best Open-Source VLMs 2026 — BentoML](https://www.bentoml.com/blog/multimodal-ai-a-guide-to-open-source-vision-language-models)
- [Best Vision Models You Can Run Locally — InsiderLLM](https://insiderllm.com/guides/vision-models-locally/)
- [Best Open-Source TTS Models 2026 — BentoML](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models)
- [Kokoro TTS Local Setup 2026](https://localaimaster.com/blog/kokoro-tts-local-setup)
- [Self-Hosted TTS Comparison — GIGAGPU](https://gigagpu.com/self-hosted-tts-comparison/)
- [Image Generation VRAM Requirements 2026](https://willitrunai.com/blog/image-generation-vram-guide-2026)
- [Free LLM APIs Compared — OpenRouter](https://openrouter.ai/blog/tutorials/free-llm-apis-compared/)
- [Best Free LLM API Tiers 2026](https://wetheflywheel.com/en/ai-model-access/free-llm-api-tiers-2026/)
