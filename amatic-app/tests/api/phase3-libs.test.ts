/**
 * docs/18 Phase 3.3 / 3.4 — the vetted diagram library and the TTS audio
 * cache, exercised against temp directories.
 */
import fs from "fs";
import os from "os";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  createDiagramLibrary,
  slugify,
} = require("../../api/lib/diagram-library.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  createAudioCache,
  synthesize,
  resolveProvider,
} = require("../../api/lib/tts.js");

const tmpDir = (prefix: string) =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe("diagram library", () => {
  it("slugifies topics deterministically", () => {
    expect(slugify("Human Heart Anatomy!")).toBe("human-heart-anatomy");
    expect(slugify("  Newton's  2nd Law ")).toBe("newton-s-2nd-law");
    expect(slugify("")).toBe("");
  });

  it("misses cleanly when the library is empty or the index is missing", () => {
    const dir = tmpDir("amatic-lib-");
    const lib = createDiagramLibrary({ dir });
    expect(lib.lookup("Human Heart Anatomy")).toBeNull();
    expect(lib.stats()).toMatchObject({ topics: 0, loadError: null });
  });

  it("serves a vetted image by topic, preferring a topic+title match", () => {
    const dir = tmpDir("amatic-lib-");
    fs.writeFileSync(path.join(dir, "heart.png"), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(dir, "flow.png"), Buffer.from([4, 5, 6]));
    fs.writeFileSync(
      path.join(dir, "index.json"),
      JSON.stringify({
        "human-heart-anatomy": [{ file: "heart.png", title: "Heart Anatomy" }],
        "human-heart-anatomy--blood-flow": [
          { file: "flow.png", title: "Blood Flow", mimeType: "image/png" },
        ],
      }),
    );
    const lib = createDiagramLibrary({ dir });
    const byTopic = lib.lookup("Human Heart Anatomy");
    expect(byTopic).toMatchObject({
      slug: "human-heart-anatomy",
      file: "heart.png",
      mimeType: "image/png",
    });
    expect(lib.readBase64(byTopic)).toBe(
      Buffer.from([1, 2, 3]).toString("base64"),
    );
    const byTitle = lib.lookup("Human Heart Anatomy", "Blood Flow");
    expect(byTitle).toMatchObject({
      slug: "human-heart-anatomy--blood-flow",
      file: "flow.png",
    });
    // A title that has no entry does NOT fall back to the bare topic:
    // otherwise every image in a turn would be the same picture.
    expect(lib.lookup("Human Heart Anatomy", "Valves")).toBeNull();
    expect(lib.lookup("Photosynthesis")).toBeNull();
  });

  it("never serves a file outside the library directory or one that is missing", () => {
    const dir = tmpDir("amatic-lib-");
    fs.writeFileSync(
      path.join(dir, "index.json"),
      JSON.stringify({
        escape: [{ file: "../../etc/passwd" }],
        gone: [{ file: "missing.png" }],
      }),
    );
    const lib = createDiagramLibrary({ dir });
    expect(lib.lookup("escape")).toBeNull();
    expect(lib.lookup("gone")).toBeNull();
  });

  it("surfaces a corrupt index instead of hiding it", () => {
    const dir = tmpDir("amatic-lib-");
    fs.writeFileSync(path.join(dir, "index.json"), "{not json");
    const lib = createDiagramLibrary({ dir });
    expect(lib.lookup("anything")).toBeNull();
    expect(lib.stats().loadError).toMatch(/JSON/);
  });
});

describe("tts audio cache", () => {
  it("keys on provider, voice, lang and text", () => {
    const cache = createAudioCache({ dir: tmpDir("amatic-tts-") });
    const base = {
      provider: "elevenlabs",
      voice: "v1",
      lang: "en-US",
      text: "Hello",
    };
    const k = cache.keyFor(base);
    expect(cache.keyFor({ ...base })).toBe(k);
    expect(cache.keyFor({ ...base, text: "Hello!" })).not.toBe(k);
    expect(cache.keyFor({ ...base, voice: "v2" })).not.toBe(k);
    expect(cache.keyFor({ ...base, provider: "kokoro" })).not.toBe(k);
  });

  it("misses, stores, then hits", () => {
    const cache = createAudioCache({ dir: tmpDir("amatic-tts-") });
    const p = {
      provider: "elevenlabs",
      voice: "v1",
      lang: "en",
      text: "Let's look at what you drew.",
    };
    expect(cache.get(p, "mp3")).toBeNull();
    cache.put(p, "mp3", Buffer.from("audio-bytes"));
    expect(cache.get(p, "mp3")?.toString()).toBe("audio-bytes");
    expect(cache.stats()).toMatchObject({ files: 1, bytes: 11 });
  });

  it("evicts least-recently-used files once over the size cap", () => {
    const cache = createAudioCache({
      dir: tmpDir("amatic-tts-"),
      maxBytes: 25,
    });
    const mk = (text: string) => ({
      provider: "p",
      voice: "v",
      lang: "l",
      text,
    });
    const old = new Date(Date.now() - 60_000);
    cache.put(mk("a"), "mp3", Buffer.alloc(10, 1));
    fs.utimesSync(
      path.join(cache.dir, `${cache.keyFor(mk("a"))}.mp3`),
      old,
      old,
    );
    cache.put(mk("b"), "mp3", Buffer.alloc(10, 2));
    // Third file pushes total to 30 > 25: the oldest ("a") must go.
    cache.put(mk("c"), "mp3", Buffer.alloc(10, 3));
    expect(cache.get(mk("a"), "mp3")).toBeNull();
    expect(cache.get(mk("b"), "mp3")).not.toBeNull();
    expect(cache.get(mk("c"), "mp3")).not.toBeNull();
  });

  it("synthesize() serves the second identical sentence from cache without a provider call", async () => {
    // No ELEVENLABS key in tests, so a provider call would throw — the first
    // call is seeded into the cache directly, then synthesize() must hit.
    const cache = createAudioCache({ dir: tmpDir("amatic-tts-") });
    const params = {
      provider: "elevenlabs",
      voice: "EXAVITQu4vr4xnSDxMaL",
      lang: "en-US",
      text: "Incredible!",
    };
    cache.put(params, "mp3", Buffer.from("cached-mp3"));
    const out = await synthesize({
      text: "Incredible!",
      lang: "en-US",
      cache,
      provider: "elevenlabs",
    });
    expect(out).toMatchObject({ cached: true, mimeType: "audio/mpeg" });
    expect(out.buffer.toString()).toBe("cached-mp3");
  });

  it("keeps the two TTS endpoints' renderings apart via `variant`", () => {
    // Same sentence and voice, different ElevenLabs settings per endpoint.
    // Without a variant in the key, whisper-tts would serve narration audio.
    const cache = createAudioCache({ dir: tmpDir("amatic-tts-") });
    const base = {
      provider: "elevenlabs",
      voice: "EXAVITQu4vr4xnSDxMaL",
      lang: "en-US",
      text: "Incredible!",
    };
    expect(cache.keyFor({ ...base, variant: "narration" })).not.toBe(
      cache.keyFor({ ...base, variant: "realtime" }),
    );
  });

  it("treats a cache write failure as non-fatal", () => {
    // Read-only/removed cache dir must not turn produced audio into a 500.
    const dir = path.join(tmpDir("amatic-tts-"), "deleted", "nested");
    const cache = createAudioCache({ dir });
    const p = { provider: "elevenlabs", voice: "v", lang: "en", text: "hi" };
    expect(cache.get(p, "mp3")).toBeNull();
    expect(() => cache.put(p, "mp3", Buffer.from("x"))).not.toThrow();
  });

  it("resolveProvider defaults to elevenlabs and only accepts known providers", () => {
    expect(resolveProvider(undefined)).toBe("elevenlabs");
    expect(resolveProvider("kokoro")).toBe("kokoro");
    expect(resolveProvider("Kokoro")).toBe("kokoro");
    expect(resolveProvider("polly")).toBe("elevenlabs");
  });
});
