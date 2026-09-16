/**
 * Text-to-speech: provider switch + audio cache (docs/18 Phase 3.4).
 *
 *   TTS_PROVIDER      elevenlabs (default) | kokoro
 *   TTS_CACHE_DIR     where synthesized audio is kept (default amatic-app/.cache/tts)
 *   TTS_CACHE_MAX_MB  size cap, least-recently-used files evicted (default 200)
 *   KOKORO_VOICE      Kokoro voice id (default af_heart); KOKORO_DTYPE q8|fp32 (default q8)
 *
 * Cache key = sha256(provider, voice, lang, variant, text), where `variant`
 * distinguishes otherwise-identical requests that render differently — the
 * two TTS endpoints use different ElevenLabs voice settings, so without it
 * one endpoint would serve the other's rendering under a cache hit.
 *
 * Stock phrases such as the recognition voice intro used to be re-synthesised
 * and re-billed on every turn; now they are paid for once per cache lifetime.
 *
 * Kokoro-82M runs locally on CPU faster than real time (docs/07, docs/08) and
 * removes a paid provider. It stays behind the flag so narration quality can
 * be A/B'd against ElevenLabs rather than cut over blind. The model (~90 MB
 * for q8) downloads from Hugging Face on first use into the transformers.js
 * cache; the first request after a cold start is slow.
 *
 * The cache is strictly best-effort: a full disk or an unwritable cache dir
 * must never turn audio we already produced (and paid for) into a 500.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { elevenLabsFor, collectAudio } = require("./providers");
const metrics = require("./metrics");

const DEFAULT_CACHE_DIR = path.resolve(__dirname, "../../.cache/tts");
const ELEVEN_DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"; // Bella
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const ELEVEN_DEFAULT_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.75,
  style: 0.35,
  use_speaker_boost: true,
};

async function synthesizeElevenLabs({ text, voice, apiKey, settings }) {
  const { client, requestOptions, timeoutMs } = elevenLabsFor("tts", apiKey);
  const streamResponse = await client.textToSpeech.convertAsStream(
    voice,
    {
      model_id: "eleven_multilingual_v2",
      text,
      voice_settings: settings || ELEVEN_DEFAULT_SETTINGS,
    },
    requestOptions,
  );
  const audioStream = streamResponse.data ?? streamResponse;
  return collectAudio(audioStream, timeoutMs, "TTS body");
}

let kokoroPromise = null;
/** Lazily load the model once per process. kokoro-js is ESM; dynamic import works from CJS. */
function loadKokoro() {
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      return KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: process.env.KOKORO_DTYPE || "q8",
        device: "cpu",
      });
    })().catch((err) => {
      kokoroPromise = null; // allow a retry after a transient download failure
      throw err;
    });
  }
  return kokoroPromise;
}

async function synthesizeKokoro({ text, voice }) {
  const tts = await loadKokoro();
  const audio = await tts.generate(text, { voice });
  return Buffer.from(audio.toWav());
}

/**
 * One row per provider, so adding a third means adding a row rather than
 * editing three ternaries (a mismatch between `ext` here and the extension
 * written to the cache would silently make every lookup miss).
 */
const PROVIDERS = {
  elevenlabs: {
    ext: "mp3",
    mimeType: "audio/mpeg",
    /** ElevenLabs voice ids come from the client; Kokoro's never do. */
    voiceFor: (requested) => requested || ELEVEN_DEFAULT_VOICE,
    synth: synthesizeElevenLabs,
  },
  kokoro: {
    ext: "wav",
    mimeType: "audio/wav",
    voiceFor: () => process.env.KOKORO_VOICE || "af_heart",
    synth: synthesizeKokoro,
  },
};

function resolveProvider(raw = process.env.TTS_PROVIDER) {
  const p = String(raw || "elevenlabs").toLowerCase();
  return PROVIDERS[p] ? p : "elevenlabs";
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function createAudioCache({
  dir = process.env.TTS_CACHE_DIR || DEFAULT_CACHE_DIR,
  maxBytes = Number(process.env.TTS_CACHE_MAX_MB || 200) * 1024 * 1024,
} = {}) {
  let ready = false;
  const ensureDir = () => {
    if (ready) return;
    fs.mkdirSync(dir, { recursive: true });
    ready = true;
  };

  const keyFor = ({ provider, voice, lang, variant, text }) =>
    crypto
      .createHash("sha256")
      .update(JSON.stringify([provider, voice || "", lang || "", variant || "", text]))
      .digest("hex");

  const fileFor = (key, ext) => path.join(dir, `${key}.${ext}`);

  function get(params, ext) {
    try {
      ensureDir();
      const file = fileFor(keyFor(params), ext);
      const buf = fs.readFileSync(file);
      // Touch so eviction is least-recently-used, not least-recently-written.
      const now = new Date();
      fs.utimesSync(file, now, now);
      return buf;
    } catch {
      return null; // miss, unreadable, or no cache dir — all mean "synthesize"
    }
  }

  function put(params, ext, buffer) {
    try {
      ensureDir();
      const file = fileFor(keyFor(params), ext);
      // Write via temp + rename so a concurrent reader never sees a partial file.
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, file);
      evict();
      return true;
    } catch {
      return false; // best effort: the audio is already in the caller's hand
    }
  }

  /** Drop oldest files until total size is under the cap. */
  function evict() {
    let entries;
    try {
      entries = fs
        .readdirSync(dir)
        .filter((n) => !n.endsWith(".tmp"))
        .map((n) => {
          const p = path.join(dir, n);
          const st = fs.statSync(p);
          return { p, size: st.size, atime: st.atimeMs || st.mtimeMs };
        });
    } catch {
      return;
    }
    let total = entries.reduce((s, e) => s + e.size, 0);
    if (total <= maxBytes) return;
    entries.sort((a, b) => a.atime - b.atime);
    for (const e of entries) {
      if (total <= maxBytes) break;
      try {
        fs.unlinkSync(e.p);
        total -= e.size;
      } catch {
        /* another process got it first */
      }
    }
  }

  function stats() {
    try {
      const names = fs.readdirSync(dir).filter((n) => !n.endsWith(".tmp"));
      const bytes = names.reduce((s, n) => s + fs.statSync(path.join(dir, n)).size, 0);
      return { dir, files: names.length, bytes, maxBytes };
    } catch {
      return { dir, files: 0, bytes: 0, maxBytes };
    }
  }

  return { get, put, keyFor, stats, dir };
}

/** Cheap readiness probe for the active provider. */
async function probeTts() {
  const provider = resolveProvider();
  if (provider === "kokoro") {
    try {
      require.resolve("kokoro-js");
      return { configured: true, ok: true, provider, note: "model loads on first request" };
    } catch {
      return { configured: true, ok: false, provider, reason: "kokoro-js not installed" };
    }
  }
  return null; // ElevenLabs is probed by readiness.js directly
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const defaultCache = createAudioCache();

/**
 * Synthesize speech, serving from cache when possible. Callers pass the
 * client's requested voice unfiltered — providers that do not take a client
 * voice id (Kokoro) ignore it, so no caller needs to know which is active.
 *
 * @param {object} p
 * @param {string} p.text
 * @param {string} [p.voice]    provider voice id as requested by the client
 * @param {string} [p.lang]
 * @param {string} [p.variant]  distinguishes different renderings of the same
 *                              text/voice (e.g. per-endpoint voice settings)
 * @param {object} [p.settings] ElevenLabs voice settings
 * @returns {Promise<{ buffer: Buffer, mimeType: string, cached: boolean }>}
 */
async function synthesize({
  text,
  voice,
  lang,
  variant,
  apiKey,
  settings,
  cache = defaultCache,
  provider = resolveProvider(),
}) {
  const p = PROVIDERS[provider];
  const voiceKey = p.voiceFor(voice);
  const params = { provider, voice: voiceKey, lang, variant, text };

  const hit = cache.get(params, p.ext);
  if (hit) {
    metrics.ttsCache.inc({ result: "hit" });
    return { buffer: hit, mimeType: p.mimeType, cached: true };
  }
  metrics.ttsCache.inc({ result: "miss" });

  const buffer = await p.synth({ text, voice: voiceKey, apiKey, settings });
  cache.put(params, p.ext, buffer);
  return { buffer, mimeType: p.mimeType, cached: false };
}

/** True when the active provider needs an ElevenLabs key. */
function needsElevenLabsKey(provider = resolveProvider()) {
  return provider === "elevenlabs";
}

module.exports = {
  synthesize,
  resolveProvider,
  needsElevenLabsKey,
  createAudioCache,
  probeTts,
  ELEVEN_DEFAULT_VOICE,
  ELEVEN_DEFAULT_SETTINGS,
};
