/**
 * Pre-generated, human-vetted diagram library (docs/18 Phase 3.3).
 *
 * School curricula are finite. A few hundred topics cover most of what a
 * student draws, and a generated diagram of a cell is frequently *subtly
 * wrong* in ways a student will not catch. This library converts image
 * generation from a per-turn variable cost into a one-time cost with a
 * teacher in the loop: generate once, approve, store, serve by topic.
 *
 * Layout (DIAGRAM_LIBRARY_DIR, default amatic-app/diagram-library/):
 *
 *   index.json            { "<topic-slug>": [ { "file": "heart-anatomy.png",
 *                            "title": "Heart Anatomy", "mimeType": "image/png",
 *                            "approvedBy": "...", "approvedAt": "2026-..." } ] }
 *   heart-anatomy.png     the vetted image
 *
 * Matching is exact-slug on purpose: fuzzy matching would serve the wrong
 * diagram with confidence, which is the failure this exists to avoid. A miss
 * returns null and the caller falls back to live generation, so an empty
 * library is a no-op.
 *
 * A request carrying a `title` (one image of several in a turn) matches ONLY
 * `topic--title`. It deliberately does not fall back to the bare topic entry:
 * a turn asking for "Blood Flow", "Valves" and "Chambers" would otherwise get
 * the same picture three times.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_DIR = path.resolve(__dirname, "../../diagram-library");
const INDEX_FILE = "index.json";
const RELOAD_MS = 60_000;

/** "Human Heart Anatomy!" → "human-heart-anatomy" */
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function createDiagramLibrary({
  dir = process.env.DIAGRAM_LIBRARY_DIR || DEFAULT_DIR,
  reloadMs = RELOAD_MS,
  log = null,
} = {}) {
  let index = null;
  let loadedAt = 0;
  let loadError = null;

  function load() {
    const now = Date.now();
    if (index && now - loadedAt < reloadMs) return index;
    loadedAt = now;
    try {
      const raw = fs.readFileSync(path.join(dir, INDEX_FILE), "utf8");
      const parsed = JSON.parse(raw);
      index = parsed && typeof parsed === "object" ? parsed : {};
      loadError = null;
    } catch (err) {
      // Missing index = empty library, which is the documented default.
      // Anything else means a bad edit silently turned every topic back into
      // a paid generation — say so where an operator will see it.
      index = {};
      loadError = err.code === "ENOENT" ? null : err;
      if (loadError) {
        const fields = { event: "diagram_library_unreadable", dir, err: err.message };
        if (log) log.warn(fields, "diagram library index unreadable; serving nothing");
        // eslint-disable-next-line no-console
        else console.warn("[diagram-library] index unreadable:", err.message);
      }
    }
    return index;
  }

  /**
   * Find a vetted image for a topic. With a `title`, only an exact
   * `topic--title` entry matches (see the module header).
   * @returns {{ file, absPath, mimeType, title, slug } | null}
   */
  function lookup(topic, title) {
    const idx = load();
    const topicSlug = slugify(topic);
    if (!topicSlug) return null;
    const titleSlug = slugify(title);
    const slug = titleSlug ? `${topicSlug}--${titleSlug}` : topicSlug;

    const entries = idx[slug];
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const entry = entries[0];
    if (!entry || typeof entry.file !== "string") return null;
    // Never let an index entry escape the library directory.
    const absPath = path.resolve(dir, entry.file);
    if (!absPath.startsWith(path.resolve(dir) + path.sep)) return null;
    if (!fs.existsSync(absPath)) return null;
    return {
      slug,
      file: entry.file,
      absPath,
      mimeType: typeof entry.mimeType === "string" ? entry.mimeType : "image/png",
      title: typeof entry.title === "string" ? entry.title : title || topic,
    };
  }

  /** Read a hit as base64 for the worker response shape. */
  function readBase64(hit) {
    return fs.readFileSync(hit.absPath).toString("base64");
  }

  function stats() {
    const idx = load();
    return {
      dir,
      topics: Object.keys(idx).length,
      loadError: loadError ? loadError.message : null,
    };
  }

  return { lookup, readBase64, stats };
}

module.exports = { createDiagramLibrary, slugify, DEFAULT_DIR, INDEX_FILE };
