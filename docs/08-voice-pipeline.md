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

## Migrating TTS to Kokoro (recommended)

Kokoro-82M runs faster than real time on this machine's CPU ([07](07-open-source-alternatives.md)).
This removes an entire paid provider.

**The endpoint contract does not change** — text in, audio bytes out — so no client edits
are needed:

1. Run Kokoro behind a small local HTTP service (Python, e.g. FastAPI)
2. Add `TTS_PROVIDER=kokoro|elevenlabs` and `KOKORO_URL` to `.env.local`
3. In `text-to-speech.js`, branch on `TTS_PROVIDER`; keep the ElevenLabs path intact
4. Map voice selection — Kokoro's 54 voices don't share ElevenLabs' IDs, so
   `DEFAULT_VOICE_ID` in the hook needs a provider-aware equivalent
5. Verify audio format matches what `new Audio(blobUrl)` accepts (WAV or MP3)

**Keep the flag.** Being able to A/B the two providers on narration quality is worth more
than the few lines it costs, and a hard cutover throws away your fallback.

## What's missing

- **No caching of generated audio.** The same sentence — "Let's look at what you drew" —
  is re-synthesised and re-billed every time. A hash → audio cache would cut spend
  measurably for stock phrases.
- **No retry.** One failed TTS call silently drops that sentence from the explanation.
- **No timeout.** A hung request stalls the queue.
- **No audio-level telemetry.** Nothing records how much narration was actually played
  versus interrupted — which is exactly the signal that tells you whether explanations are
  too long.

## Next

- [09-canvas-integration.md](09-canvas-integration.md)
- [06-costs.md](06-costs.md)
