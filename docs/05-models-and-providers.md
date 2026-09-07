# 05 — Models and Providers

## Single source of truth

`amatic-app/api/ai/models.js`:

```js
module.exports = {
  TEACHING_MODEL: "claude-sonnet-5",   // master + recognize
  CHAT_MODEL:     "claude-sonnet-5",   // chat + chat-simple
};
```

**Never inline a model string.** They were previously duplicated across four files and
drifted: two endpoints reported `model: "claude-sonnet-4"` to clients while actually
calling `claude-sonnet-4-20250514`. See [16](16-decisions.md) ADR-001.

Both constants point at the same model today. They are kept separate so the chat path can
diverge (e.g. to a cheaper model) without reintroducing literals.

## Current configuration

| Endpoint | Model | max_tokens | effort | thinking | temperature |
|---|---|---|---|---|---|
| `/api/ai/master` | `claude-sonnet-5` | 64000 | `medium` | adaptive | **omitted** |
| `/api/ai/recognize` | `claude-sonnet-5` | 8000 | `low` | adaptive | **omitted** |
| `/api/ai/chat` | `claude-sonnet-5` | 8000 | `low` | adaptive | **omitted** |
| `/api/voice/chat-simple` | `claude-sonnet-5` | 8000 | `low` | adaptive | **omitted** |
| `/api/ai/worker` | `gemini-2.5-flash-image` | — | — | — | — |
| TTS | ElevenLabs `eleven_multilingual_v2` | — | — | — | — |

SDK: `@anthropic-ai/sdk` **0.124.0**.

## Claude Sonnet 5: the rules that matter here

**1. Sampling parameters are rejected.** `temperature`, `top_p`, `top_k` return a **400**
at non-default values. All four endpoints previously set `temperature` (0.7, and 0.3 on
recognize "for more deterministic JSON"). All removed. Determinism must now be steered by
the system prompt.

**2. Thinking is on by default, and shares `max_tokens`.** Omitting `thinking` on Sonnet 5
runs adaptive thinking — the previous model ran thinking-*off* when omitted. Since
`max_tokens` caps thinking **plus** output, a budget tuned for the old model can now be
spent almost entirely on thinking, truncating the answer with
`stop_reason: "max_tokens"`. This is exactly why `recognize` moved 2000 → 8000.

We set `thinking: { type: "adaptive" }` **explicitly** rather than relying on the default,
so the behaviour is visible to anyone reading the code.

**3. `thinking.display` defaults to `"omitted"`.** Thinking blocks stream with empty text.
For `master`'s SSE this is harmless — the client filters to `text_delta` — but it means a
perceptible pause before the first spoken word. If you want to surface reasoning, set
`display: "summarized"`.

**4. The tokenizer changed.** ~30% more tokens for the same text than the previous
generation. Any token budget or cost baseline measured on an older model is wrong. Re-run
`count_tokens` against `claude-sonnet-5`; do not reuse old numbers.

**5. 1M context is native.** No beta header. Two `betas: ["context-1m-2025-08-07"]` flags
were removed — they were no-ops anyway, since beta flags only apply on
`client.beta.messages.*`, not `client.messages.*`. See [16](16-decisions.md) ADR-004.

## Choosing `effort`

Sonnet 5 supports `low` / `medium` / `high` / `xhigh` / `max`, defaulting to `high`.
Useful mapping when tuning: **Sonnet 5 at `medium` ≈ the previous generation at `high`**.

| Endpoint | Set to | Why |
|---|---|---|
| `master` | `medium` | Holds prior teaching quality while limiting the latency a student waits through. Raise to `high`/`xhigh` for richer turns |
| `recognize` | `low` | Fast classification on the hot path; the old config ran thinking-off entirely |
| chat | `low` | Simple Q&A |

These are **reasoned defaults, not measurements.** No API call has been made against this
configuration. They should be tuned against real turns once keys exist.

## Provider setup

### Anthropic
Console → API keys. Env: `ANTHROPIC_API_KEY`. Note the SDK also accepts
`ANTHROPIC_AUTH_TOKEN` or an `ant auth login` profile — but `server.js` explicitly checks
`process.env.ANTHROPIC_API_KEY` and errors if absent, so the env var is required here.

### Google (Gemini)
Google AI Studio → Get API key. Env: `GOOGLE_AI_API_KEY` (or `GOOGLE_GEMINI_API_KEY`).
Uses `@google/genai`.

### ElevenLabs
Dashboard → Profile → API key. Env: `ELEVENLABS_API_KEY`. Voice IDs are in the Voice Lab;
the default `EXAVITQu4vr4xnSDxMaL` is a stock voice.

## Migrating models

1. Change **only** `models.js`
2. Check the new model's breaking changes — sampling params and thinking config are the
   usual traps
3. Re-check every `max_tokens` if the tokenizer changed
4. `node --check` each touched file (`api/` is in `.eslintignore`, so lint won't catch it)
5. **Restart the backend** — Express has no watcher
6. Verify what actually goes on the wire, not just that the code compiles. A local sink
   server plus `ANTHROPIC_BASE_URL` is the cheapest way to confirm the request shape
   without spending a token

## Next

- [06-costs.md](06-costs.md)
- [07-open-source-alternatives.md](07-open-source-alternatives.md)
