# 08 — Voice Pipeline

Two independent halves. **Input is free and in-browser; output is a paid API call.**

---

## Input — Speech to Text

`amatic-app/lib/voice/voice-monitor.ts`, ~194 lines.

Uses the **browser Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`):

```ts
recognition.continuous = true;      // don't stop after one utterance
recognition.interimResults = true;  // surface partial transcripts live
recognition.lang = "en-US";         // overridden by detectLanguage()
```

**Costs nothing.** No server round-trip, no provider key.

### Behaviour

- **Auto-restart.** `onend` restarts recognition, so a long session doesn't silently stop
  listening.
- **Confidence gate.** `MIN_VOICE_CONFIDENCE = 0.65` in the hook. Below that the transcript
  is discarded as likely garbled. A reported confidence of `0` means the browser doesn't
  supply the metric, and is passed through rather than rejected.
- **Dynamic language.** `canvas-monitor.detectLanguage()` inspects the canvas; if the
  student is writing in another language, `voiceMonitor.setLanguage()` swaps
  `recognition.lang` and restarts so the change takes effect immediately. That is a genuinely
  thoughtful touch for a multilingual classroom.
- **Feature detection.** Guards on `"SpeechRecognition" in window` and falls back cleanly.

### Known limitations

| Limitation | Impact |
|---|---|
| **Chrome/Edge only in practice** | Firefox and Safari support is partial or absent. A Firefox user gets a silent tutor |
| **Chrome sends audio to Google servers** | Not local processing. A privacy consideration for a product aimed at children |
| **Requires network** | Offline mode loses voice input |
| **No diarisation** | Cannot distinguish teacher from student |

### The server-side stub

`amatic-app/api/voice/speech-to-text.js` **always returns an empty transcript**:

```js
res.json({ transcript: "", message: "Use Web Speech API in browser..." });
```

Nothing calls it. A 200 with empty data is worse than a 501 — it looks like success.
**Either implement it (Whisper) or delete the route.**

---

## Output — Text to Speech

`amatic-app/api/voice/text-to-speech.js` → ElevenLabs.

| Setting | Value |
|---|---|
| Model | `eleven_multilingual_v2` |
| Default voice | `EXAVITQu4vr4xnSDxMaL` ("Bella") |
| `stability` | 0.45 — looser, more natural variation |
| `similarity_boost` | 0.75 |
| `style` | 0.35 — adds expression |
| `use_speaker_boost` | true |
| Max input | 5,000 characters |

Response is raw audio bytes, collected from a streaming ElevenLabs response and returned
as one buffer.

### Client playback

`playNextVoice()` in the hook is a **sequential recursive queue**:

```
shift sentence -> POST /api/voice/text-to-speech -> Blob -> Audio -> play
  onended  -> revokeObjectURL, recurse
  onerror  -> recurse (skip the bad item, don't stall)
  aborted  -> stop entirely
```

Only one `HTMLAudioElement` plays at a time, and a new teaching turn calls `.pause()` on
the current one and clears the queue — so a student who draws again mid-explanation
doesn't get two voices overlapping. This is correct and easy to get wrong.

### The cost characteristic that matters

**One HTTP request per sentence.** A long explanation is many round-trips. This is the
main driver of ElevenLabs character spend ([06](06-costs.md)), and each request adds
latency between sentences.

Batching per paragraph would cut requests, but delays the first spoken word — a real UX
trade-off, not a free win. The current design optimises for *time to first audio*, which
for a tutor is probably the right call.

---

## Kokoro behind a flag (implemented — docs/18 Phase 3.4)

Kokoro-82M runs in-process via `kokoro-js` (ONNX on CPU), faster than real time on this
machine ([07](07-open-source-alternatives.md)). It removes an entire paid provider. Both
providers live in `amatic-app/api/lib/tts.js`; the endpoint contract is unchanged — text
in, audio bytes out — and the client plays whatever `Content-Type` comes back.

| Variable | Default | Meaning |
|---|---|---|
| `TTS_PROVIDER` | `elevenlabs` | `elevenlabs` or `kokoro` |
| `KOKORO_VOICE` | `af_heart` | Kokoro voice id (54 available; ElevenLabs ids are ignored on this provider) |
| `KOKORO_DTYPE` | `q8` | `q8` (~90 MB, fast) or `fp32` (larger, best quality) |
| `TTS_CACHE_DIR` | `amatic-app/.cache/tts` | synthesized audio cache (gitignored) |
| `TTS_CACHE_MAX_MB` | `200` | cache size cap, least-recently-used files evicted first |

The model downloads from Hugging Face into the transformers.js cache on the **first
request after a cold start** — measured at ~34 s including download on this machine; every
later request for the same sentence is a cache hit (0 ms). `/readyz` reports the active
provider, so a missing `ELEVENLABS_API_KEY` does not fail readiness when Kokoro is active.

**Keep the flag.** Being able to A/B the two providers on narration quality is worth more
than the few lines it costs, and a hard cutover throws away your fallback. Responses carry
`X-TTS-Provider` and `X-TTS-Cache: hit|miss` so you can tell which path served a sentence.

## Audio cache

Every synthesized sentence is stored under `sha256(provider, voice, lang, text)`. Stock
phrases — the recognition voice intro, "Incredible!" — used to be re-synthesised and
re-billed on every turn; now they are paid for once. Hits and misses are counted in
`amatic_tts_cache_total{result}`, and `tts_call` log events carry `cached: true|false`.
Cache hits are excluded from the provider latency and call-count series.

## What's missing

- **No audio-level telemetry.** Nothing records how much narration was actually played
  versus interrupted — which is exactly the signal that tells you whether explanations are
  too long. (`turn_complete` reports how many sentences were queued, not played.)
- **Retry and timeout** are now handled — 20 s to headers plus 20 s for the body, two
  retries on 429/5xx — see [04](04-api-reference.md).

## Next

- [09-canvas-integration.md](09-canvas-integration.md)
- [06-costs.md](06-costs.md)
