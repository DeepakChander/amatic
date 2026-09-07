/**
 * useCanvasJarvis - Amatic Canvas AI
 *
 * Always watching the canvas and always listening.
 * Features Samsung-style background drawing recognition:
 * - While the user draws, a background vision fetch recognizes the drawing
 * - A full teaching brief (Gemini prompts, labels, voice intro) is cached
 * - When the user pauses, visuals dispatch instantly — no acknowledgment,
 *   no "I see you drew X", just content appearing on the canvas
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { randomId } from "@amatic/common";
import {
  newTextElement,
  newImageElement,
  syncInvalidIndicesImmutable,
} from "@amatic/element";
import { exportToCanvas } from "@amatic/amatic";
import type { ExcalidrawElement } from "@amatic/element/types";
import { CanvasMonitor } from "@/lib/ai/canvas-monitor";
import type {
  CanvasZone,
  CanvasZoneMap,
  UserContentBounds,
} from "@/lib/ai/canvas-monitor";
import { getSpatialMemory } from "@/lib/ai/spatial-memory";
import {
  newCorrelationId,
  recordMasterError,
  recordRecognizeFailure,
  recordWorkerDropped,
  recordWorkerFailure,
} from "@/lib/ai/telemetry";
import { WorkerQueue } from "@/lib/ai/worker-queue";
import { VoiceMonitor } from "@/lib/voice/voice-monitor";
import { CaptureUpdateAction } from "@amatic/amatic";
import type { ExcalidrawImperativeAPI } from "@amatic/amatic/types";
import type { FileId } from "@amatic/element/types";
import type { BinaryFileData } from "@amatic/amatic/types";

// ---------------------------------------------------------------------------
// TeachingBrief — returned by /api/ai/recognize, cached for fast-path dispatch
// ---------------------------------------------------------------------------

interface VisualBrief {
  prompt: string;
  style: string;
  title: string;
}

interface TeachingBrief {
  topic: string;
  confidence: "high" | "medium" | "low";
  visualBriefs: VisualBrief[];
  canvasLabels: { content: string; fontSize: number }[];
  voiceIntro: string;
  elementId: string;
  timestamp: number;
  /** Correlation id sent as x-turn-id on the /api/ai/recognize call that
   *  produced this brief. Forwarded in the master request so, once the
   *  backend logs by turn id (docs/18 Phase 2.2), recognition and the turn
   *  that consumed it can be joined. */
  recognitionId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Combines existing scene elements with a new element and ensures all
 * fractional indices are valid.
 */
function mergeWithValidIndices(
  existing: readonly ExcalidrawElement[],
  newEl: ExcalidrawElement,
): ExcalidrawElement[] {
  const merged = [...existing, newEl] as ExcalidrawElement[];
  const synced = syncInvalidIndicesImmutable(merged);
  return synced ? Array.from(synced.values()) : merged;
}

/**
 * Find the best free position for new AI content.
 */
function findNextFreePosition(
  zoneMap: CanvasZoneMap,
  allBounds: UserContentBounds,
  api: ExcalidrawImperativeAPI,
): { x: number; y: number } {
  const appState = api.getAppState();
  const zoom = appState.zoom.value || 1;
  const { scrollX, scrollY } = appState;

  const zoneToScene = (zone: CanvasZone) => ({
    x: (zone.x - scrollX) / zoom,
    y: (zone.y - scrollY) / zoom,
  });

  const belowY = allBounds.maxY + 40;
  const belowCells = zoneMap.freeCells.filter((z) => {
    const scenePos = zoneToScene(z);
    return scenePos.y >= belowY - 50;
  });

  if (belowCells.length > 0) return zoneToScene(belowCells[0]);
  if (zoneMap.freeCells.length > 0) return zoneToScene(zoneMap.freeCells[0]);
  return { x: allBounds.x, y: allBounds.maxY + 40 };
}

/**
 * Export the canvas as a compressed JPEG thumbnail.
 * Scales to maxWidth wide to keep payload small.
 */
async function exportThumbnail(
  api: ExcalidrawImperativeAPI,
  onlyElements?: readonly ExcalidrawElement[],
  maxWidth = 512,
): Promise<string | null> {
  try {
    const elements =
      onlyElements ??
      api.getSceneElements().filter((el) => !el.id.startsWith("ai-"));
    if (elements.length === 0) return null;

    const htmlCanvas = await exportToCanvas({
      elements,
      appState: api.getAppState(),
      files: api.getFiles(),
    });

    const thumb = document.createElement("canvas");
    const scale = Math.min(1, maxWidth / htmlCanvas.width);
    thumb.width = Math.max(1, Math.round(htmlCanvas.width * scale));
    thumb.height = Math.max(1, Math.round(htmlCanvas.height * scale));
    thumb.getContext("2d")!.drawImage(htmlCanvas, 0, 0, thumb.width, thumb.height);
    const dataUrl = thumb.toDataURL("image/jpeg", 0.75);
    return dataUrl.split(",")[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Samsung-style background pre-analysis.
 * Fires while the user is still drawing — does not block the debounce.
 * Exports only the most recent large freedraw element, sends to /api/ai/recognize,
 * and caches the full teaching brief.
 */
/** Session-scoped image hash → brief cache. Avoids re-calling /api/ai/recognize
 *  for the same drawing (e.g. student draws the same shape twice in one session). */
const _recognitionHashCache = new Map<string, TeachingBrief>();

/** The recognition request currently in flight, if any. A new stroke
 *  supersedes it: the older request is aborted so a slow answer about an
 *  earlier drawing can never overwrite the brief for the current one. */
let _activeRecognition: AbortController | null = null;
/** Client-side ceiling on one recognition round-trip. The server gives up at
 *  20 s; this only guards against a proxy or network that never answers. */
const RECOGNIZE_CLIENT_TIMEOUT_MS = 25_000;

/** Fast, non-cryptographic hash of the first 120 chars of a base64 string.
 *  Good enough to detect duplicate/similar drawings within a session. */
function quickImageHash(b64: string): string {
  const sample = b64.slice(0, 120);
  let h = 0x811c9dc5;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

async function captureAndRecognize(
  api: ExcalidrawImperativeAPI,
  cacheRef: React.MutableRefObject<TeachingBrief | null>,
): Promise<void> {
  const recognitionId = newCorrelationId();
  // Supersede any recognition still running for an earlier stroke.
  _activeRecognition?.abort();
  const controller = new AbortController();
  _activeRecognition = controller;
  const timeout = setTimeout(
    () => controller.abort(),
    RECOGNIZE_CLIENT_TIMEOUT_MS,
  );
  try {
    const freedrawEls = api
      .getSceneElements()
      .filter(
        (el) =>
          el.type === "freedraw" &&
          !el.id.startsWith("ai-") &&
          el.width >= 50 &&
          el.height >= 50,
      );
    if (freedrawEls.length === 0) return;

    const target = freedrawEls[freedrawEls.length - 1];
    const base64 = await exportThumbnail(api, [target], 384);
    if (!base64) return;

    // Check session hash cache first — skip the API call if we already know this drawing
    const hash = quickImageHash(base64);
    const cached = _recognitionHashCache.get(hash);
    if (cached) {
      cacheRef.current = { ...cached, timestamp: Date.now() };
      return;
    }

    const res = await fetch("/api/ai/recognize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-turn-id": recognitionId,
      },
      body: JSON.stringify({ canvasImage: base64 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      recordRecognizeFailure(new Error(`HTTP ${res.status}`), recognitionId);
      return;
    }

    const brief: Partial<TeachingBrief> = await res.json();
    // A newer stroke started its own recognition while this one was in
    // flight; its answer is the one that matches the canvas now.
    if (_activeRecognition !== controller) {
      return;
    }
    if (brief?.topic) {
      const result: TeachingBrief = {
        topic: brief.topic ?? "",
        confidence: brief.confidence ?? "low",
        visualBriefs: brief.visualBriefs ?? [],
        canvasLabels: brief.canvasLabels ?? [],
        voiceIntro: brief.voiceIntro ?? "",
        elementId: target.id,
        timestamp: Date.now(),
        recognitionId,
      };
      cacheRef.current = result;
      // Store in session cache (limit to 30 entries to avoid unbounded growth)
      if (_recognitionHashCache.size >= 30) {
        const firstKey = _recognitionHashCache.keys().next().value;
        if (firstKey !== undefined) _recognitionHashCache.delete(firstKey);
      }
      _recognitionHashCache.set(hash, result);
    }
  } catch (err) {
    // Superseded by a newer stroke — not a failure.
    if (
      (err as Error)?.name === "AbortError" &&
      _activeRecognition !== controller
    ) {
      return;
    }
    // Non-fatal for the student — a background failure must never interrupt
    // drawing — but counted and logged so a systematically failing
    // recognizer is visible (docs/18 Phase 1.2).
    recordRecognizeFailure(err, recognitionId);
  } finally {
    clearTimeout(timeout);
    if (_activeRecognition === controller) {
      _activeRecognition = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDLE_DEBOUNCE_MS = 3000;
const PROACTIVE_COOLDOWN_MS = 15000;
/** Minimum Web Speech API confidence score to act on a voice transcript.
 *  0 = browser doesn't report confidence (pass through); <0.65 = likely garbled. */
const MIN_VOICE_CONFIDENCE = 0.65;
const IMAGE_WIDTH = 400;
const IMAGE_HEIGHT = 300;
const PLACEMENT_PAD = 20;
const IMAGES_PER_ROW = 2;
const TEXT_ROW_WIDTH = 700;
const TEXT_ROW_HEIGHT = 50;
const TEXT_COL_STEP = 220;
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const MAX_CONCURRENT_WORKERS = 3;
/** Briefs waiting behind the running workers. 3 running + 5 queued covers
 *  the 3–6 visual prompts a turn produces without dropping any. */
const WORKER_QUEUE_DEPTH = 5;
/** Consecutive worker failures before the turn stops dispatching images. */
const WORKER_CIRCUIT_THRESHOLD = 3;
/** Brief is considered fresh for 30 seconds after recognition */
const BRIEF_TTL_MS = 30_000;
/** Shown when the backend reports a failure without a usable message. */
const GENERIC_TUTOR_ERROR = "The tutor could not respond.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JarvisPhase =
  | "idle"
  | "watching"
  | "listening"
  | "teaching"
  | "error";

export interface TeachingContext {
  intent?: string;
  content?: string;
  voice?: string;
  pointedElement?: string;
  memory?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCanvasJarvis(
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  micEnabled: boolean = true,
): {
  jarvisPhase: JarvisPhase;
  currentTranscript: string;
  /** Student-facing description of the last teaching failure, or null. */
  jarvisError: string | null;
} {
  const [jarvisPhase, setJarvisPhase] = useState<JarvisPhase>("idle");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [jarvisError, setJarvisError] = useState<string | null>(null);

  const monitorRef = useRef<CanvasMonitor | null>(null);
  const voiceMonitorRef = useRef<VoiceMonitor | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownUntilRef = useRef<number>(0);
  const teachingAbortRef = useRef<AbortController | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceQueueRef = useRef<string[]>([]);
  const isPlayingVoiceRef = useRef(false);
  /** Bounded image-worker queue for the current turn (docs/18 Phase 1.4). */
  const workerQueueRef = useRef<WorkerQueue | null>(null);
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Cached teaching brief from background recognition */
  const recognitionCacheRef = useRef<TeachingBrief | null>(null);

  const startTeaching = useCallback(
    async (context: TeachingContext) => {
      const api = excalidrawAPI;
      if (!api) return;

      // Interrupt any running session
      if (teachingAbortRef.current) {
        teachingAbortRef.current.abort();
      }
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch { /* ignore */ }
        currentAudioRef.current = null;
      }
      voiceQueueRef.current = [];
      isPlayingVoiceRef.current = false;

      const abort = new AbortController();
      teachingAbortRef.current = abort;
      // One id for every request in this turn — recognize is the exception,
      // it runs before the turn exists and carries its own id in the brief.
      // The backend reads and echoes this header from Phase 2.2 onward.
      const turnId = newCorrelationId();
      const turnHeaders = {
        "Content-Type": "application/json",
        "x-turn-id": turnId,
      };
      workerQueueRef.current?.close();
      const dropsByReason: Record<string, number> = {};
      const workerQueue = new WorkerQueue({
        concurrency: MAX_CONCURRENT_WORKERS,
        maxQueued: WORKER_QUEUE_DEPTH,
        circuitThreshold: WORKER_CIRCUIT_THRESHOLD,
        onFailure: (err, n) => recordWorkerFailure(err, turnId, n),
        onDrop: (reason) => {
          dropsByReason[reason] = (dropsByReason[reason] ?? 0) + 1;
          recordWorkerDropped(turnId, reason);
        },
      });
      workerQueueRef.current = workerQueue;
      // A failure in this turn flips the status dot red and stays until the
      // next turn starts, so a student sees "broken", not "listening".
      let turnFailed = false;
      let turnError: string | null = null;
      const failTurn = (message: string) => {
        turnFailed = true;
        turnError = message;
        recordMasterError(turnId, message);
        setJarvisError(message);
        setJarvisPhase("error");
      };
      // Per-turn counts for the turn_complete report (docs/18 Phase 2.3).
      const turnStarted = Date.now();
      const counts = { voiceSentences: 0, canvasTexts: 0, imagesRequested: 0 };
      let usedFastPath = false;
      let turnRecognitionId: string | undefined;
      const reportTurn = () => {
        const stats = workerQueue.stats();
        const outcome = turnFailed
          ? "error"
          : abort.signal.aborted
            ? "aborted"
            : "done";
        const body = JSON.stringify({
          outcome,
          durationMs: Date.now() - turnStarted,
          fastPath: usedFastPath,
          recognitionId: turnRecognitionId,
          ...counts,
          workers: {
            completed: stats.completed,
            failed: stats.failed,
            dropped: stats.dropped,
            droppedByReason: dropsByReason,
          },
          error: turnError,
        });
        // keepalive lets the report leave even if the tab is closing.
        fetch("/api/telemetry/turn", {
          method: "POST",
          headers: turnHeaders,
          body,
          keepalive: true,
        }).catch(() => {
          /* telemetry must never surface to the student */
        });
      };
      setJarvisError(null);
      setJarvisPhase("teaching");

      // Leave without a turn. Must release the abort ref: while it is set,
      // the idle trigger and background recognition both treat a turn as
      // running and proactive teaching never fires again for the session.
      const bailOut = () => {
        if (teachingAbortRef.current === abort) {
          teachingAbortRef.current = null;
        }
        if (workerQueueRef.current === workerQueue) {
          workerQueue.close();
          workerQueueRef.current = null;
        }
        setJarvisPhase("watching");
      };

      const canvasMonitor = monitorRef.current;
      const spatialMemory = getSpatialMemory();
      if (!canvasMonitor) {
        bailOut();
        return;
      }

      // ------------------------------------------------------------------
      // Recognition cache check
      // ------------------------------------------------------------------
      const cached = recognitionCacheRef.current;
      const briefIsFresh =
        cached !== null && Date.now() - cached.timestamp < BRIEF_TTL_MS;

      // Skip proactive teaching (no voice) if recognition was low-confidence
      if (briefIsFresh && cached!.confidence === "low" && !context.voice) {
        bailOut();
        return;
      }

      // ------------------------------------------------------------------
      // Core setup
      // ------------------------------------------------------------------
      const spatialContext = canvasMonitor.extractSpatialContext();
      const memoryContext =
        context.memory ?? spatialMemory.getConversationContext();

      // Detect canvas language and update VoiceMonitor so recognition
      // uses the correct language for the student's input
      const detectedLang = canvasMonitor.detectLanguage();
      if (voiceMonitorRef.current) {
        voiceMonitorRef.current.setLanguage(detectedLang);
      }

      const message =
        context.voice ??
        context.content ??
        (canvasMonitor.getLatestUserContent() ||
          "The student added or changed something on the canvas.");
      const userIntent = spatialContext.userIntent;

      // ------------------------------------------------------------------
      // Canvas thumbnail (for master.js vision context)
      // ------------------------------------------------------------------
      const freedrawEls = api
        .getSceneElements()
        .filter((el) => el.type === "freedraw" && !el.id.startsWith("ai-"));
      const canvasImage =
        freedrawEls.length > 0
          ? await exportThumbnail(
              api,
              api.getSceneElements().filter((el) => !el.id.startsWith("ai-")),
              512,
            )
          : null;

      // ------------------------------------------------------------------
      // Placement origin — based on all elements so AI never overwrites
      // ------------------------------------------------------------------
      const allBounds = canvasMonitor.getAllElementsBounds();
      const zoneMap = spatialContext.canvasZones;
      const startPos = findNextFreePosition(zoneMap, allBounds, api);
      let placeX = startPos.x;
      let placeY = startPos.y;
      const startX = placeX;
      let imagesInRow = 0;

      // ------------------------------------------------------------------
      // Voice playback helper (defined before fast path so both can use it)
      // ------------------------------------------------------------------
      const playNextVoice = async () => {
        if (voiceQueueRef.current.length === 0) {
          isPlayingVoiceRef.current = false;
          return;
        }
        const text = voiceQueueRef.current.shift()!;
        if (abort.signal.aborted) return;
        try {
          const ttsRes = await fetch("/api/voice/text-to-speech", {
            method: "POST",
            headers: turnHeaders,
            body: JSON.stringify({ text, voiceId: DEFAULT_VOICE_ID, lang: detectedLang }),
            signal: abort.signal,
          });
          if (!ttsRes.ok || abort.signal.aborted) return;
          const blob = await ttsRes.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          currentAudioRef.current = audio;
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => {
              URL.revokeObjectURL(url);
              currentAudioRef.current = null;
              resolve();
            };
            audio.onerror = reject;
            audio.play().catch(reject);
          });
          if (!abort.signal.aborted) playNextVoice();
        } catch {
          if (!abort.signal.aborted) playNextVoice();
        }
      };

      // ------------------------------------------------------------------
      // Worker dispatch helper (used by both fast path and processLine)
      // ------------------------------------------------------------------
      // Runs at most MAX_CONCURRENT_WORKERS at once and queues the rest —
      // briefs 4-5 of a turn used to be silently discarded here. One failure
      // no longer blocks later images; only WORKER_CIRCUIT_THRESHOLD
      // consecutive failures stop the turn's dispatch.
      const dispatchWorker = (prompt: string, style: string) => {
        if (abort.signal.aborted) {
          return;
        }
        counts.imagesRequested++;
        workerQueue.enqueue(async () => {
          if (abort.signal.aborted) {
            return;
          }
          try {
            const workerRes = await fetch("/api/ai/worker", {
              method: "POST",
              headers: turnHeaders,
              body: JSON.stringify({ prompt, style: style || "schematic", workerId: 1 }),
              signal: abort.signal,
            });
            if (!workerRes.ok) {
              throw new Error(`worker HTTP ${workerRes.status}`);
            }
            const json = await workerRes.json();
            const dataUrl = json.imageUrl;
            const imageBase64 = json.imageData;
            const mimeType = json.imageMimeType || "image/png";
            if (!imageBase64) {
              throw new Error("worker returned no image data");
            }
            if (abort.signal.aborted) {
              return;
            }

            const fileId = randomId() as FileId;
            const newFiles: BinaryFileData[] = [
              {
                id: fileId,
                mimeType: mimeType as BinaryFileData["mimeType"],
                dataURL: dataUrl,
                created: Date.now(),
              },
            ];
            const imageEl = {
              ...newImageElement({
                type: "image",
                x: placeX,
                y: placeY,
                width: IMAGE_WIDTH,
                height: IMAGE_HEIGHT,
                fileId,
                status: "saved",
              }),
              id: `ai-${randomId()}`,
            };

            api.addFiles(newFiles);
            const current = api.getSceneElements();
            api.updateScene({
              elements: mergeWithValidIndices(current, imageEl),
              captureUpdate: CaptureUpdateAction.NEVER,
            });

            placeX += IMAGE_WIDTH + PLACEMENT_PAD;
            imagesInRow++;
            if (imagesInRow >= IMAGES_PER_ROW) {
              placeX = startX;
              placeY += IMAGE_HEIGHT + PLACEMENT_PAD;
              imagesInRow = 0;
            }
          } catch (err) {
            // An interrupted turn is not a worker failure.
            if ((err as Error)?.name === "AbortError") {
              return;
            }
            throw err;
          }
        });
      };

      // ------------------------------------------------------------------
      // FAST PATH — high-confidence brief available
      // Dispatch Gemini workers immediately with pre-built prompts.
      // Then call master.js only for voice narration + canvas labels.
      // ------------------------------------------------------------------
      let visualsAlreadyDispatched = false;
      if (briefIsFresh) {
        turnRecognitionId = cached!.recognitionId;
      }
      if (briefIsFresh && cached!.confidence === "high" && cached!.visualBriefs.length > 0) {
        usedFastPath = true;
        // Queue voice intro and start playing
        counts.voiceSentences++;
        voiceQueueRef.current.push(cached!.voiceIntro);
        if (!isPlayingVoiceRef.current) {
          isPlayingVoiceRef.current = true;
          playNextVoice();
        }
        // Dispatch all pre-built Gemini prompts. The queue runs three at a
        // time and holds the rest, so a 5-brief topic renders all 5.
        for (const vb of cached!.visualBriefs) {
          dispatchWorker(vb.prompt, vb.style);
        }
        visualsAlreadyDispatched = true;
        // Consume the cache so a second trigger goes through full path
        recognitionCacheRef.current = null;
      }

      // ------------------------------------------------------------------
      // POST to master.js (always — for voice narration, labels, depth)
      // ------------------------------------------------------------------
      const body = {
        message,
        canvasContext: spatialContext,
        userIntent,
        pointedElement: context.pointedElement ?? undefined,
        voiceTranscript: context.voice ?? undefined,
        memoryContext: memoryContext || undefined,
        canvasImage: canvasImage ?? undefined,
        teachingBrief: briefIsFresh
          ? {
              topic: cached!.topic,
              confidence: cached!.confidence,
              visualsAlreadyDispatched,
              canvasLabels: cached!.canvasLabels,
              voiceIntro: cached!.voiceIntro,
              recognitionId: cached!.recognitionId,
            }
          : undefined,
      };

      try {
        const res = await fetch("/api/ai/master", {
          method: "POST",
          headers: turnHeaders,
          body: JSON.stringify(body),
          signal: abort.signal,
        });
        if (!res.ok) {
          failTurn(`The tutor is unavailable (HTTP ${res.status}).`);
          return;
        }
        if (!res.body) {
          failTurn("The tutor sent an empty response.");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processLine = (line: string) => {
          const m = line.match(/^data:\s*(.+)/);
          if (!m) return;
          try {
            const data = JSON.parse(m[1].trim());

            if (data.type === "voice" && data.text) {
              counts.voiceSentences++;
              voiceQueueRef.current.push(data.text);
              if (!isPlayingVoiceRef.current) {
                isPlayingVoiceRef.current = true;
                playNextVoice();
              }
            } else if (
              data.type === "visual_prompt" &&
              data.prompt &&
              !abort.signal.aborted &&
              !visualsAlreadyDispatched // skip if fast path already dispatched
            ) {
              dispatchWorker(data.prompt, data.style || "schematic");
            } else if (
              data.type === "canvas_text" &&
              data.content != null &&
              !abort.signal.aborted
            ) {
              counts.canvasTexts++;
              const fontSize =
                typeof data.fontSize === "number" ? data.fontSize : 24;
              const textEl = {
                ...newTextElement({
                  x: placeX,
                  y: placeY,
                  text: String(data.content),
                  fontSize,
                }),
                id: `ai-${randomId()}`,
              };
              const current = api.getSceneElements();
              api.updateScene({
                elements: mergeWithValidIndices(current, textEl),
                captureUpdate: CaptureUpdateAction.NEVER,
              });
              placeX += TEXT_COL_STEP;
              if (placeX > startX + TEXT_ROW_WIDTH) {
                placeX = startX;
                placeY += TEXT_ROW_HEIGHT;
              }
            } else if (data.type === "next_topic" && data.suggestion && !abort.signal.aborted) {
              // Place a subtle "Next: ..." suggestion below all AI content
              const nextBounds = canvasMonitor.getAllElementsBounds();
              const suggestionEl = {
                ...newTextElement({
                  x: nextBounds.x,
                  y: nextBounds.maxY + 30,
                  text: `→ Next: ${data.suggestion}`,
                  fontSize: 16,
                }),
                id: `ai-${randomId()}`,
              };
              const currentEls = api.getSceneElements();
              api.updateScene({
                elements: mergeWithValidIndices(currentEls, suggestionEl),
                captureUpdate: CaptureUpdateAction.NEVER,
              });
            } else if (data.type === "done") {
              canvasMonitor.markTeachingComplete();
              cooldownUntilRef.current = Date.now() + PROACTIVE_COOLDOWN_MS;
              spatialMemory.addToConversationFlow(
                message,
                "[Amatic response stream]",
                [],
                "general",
              );
            } else if (data.type === "error") {
              // master.js reports provider/validation failures on the stream
              // itself. This branch used to be missing, so the dot stayed
              // green while the turn had already died (docs/18 Phase 1.1).
              failTurn(
                typeof data.message === "string" && data.message.trim()
                  ? data.message
                  : GENERIC_TUTOR_ERROR,
              );
            }
          } catch {
            // skip malformed JSON
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";
          for (const block of lines) {
            if (abort.signal.aborted) break;
            processLine(block);
          }
        }
        if (buffer.trim()) processLine(buffer);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          // Network failure before or during the stream — the backend is
          // down or unreachable. Interrupts (AbortError) are expected.
          failTurn(GENERIC_TUTOR_ERROR);
        }
      } finally {
        canvasMonitor?.markTeachingComplete();
        // Persist memory after every teaching session
        spatialMemory.saveToStorage();
        // Workers may still be rendering; their own requests carry the same
        // turnId, so the report is the turn's end from the student's side.
        reportTurn();
        // Shared state belongs to whichever turn is current. When this turn
        // was interrupted by a newer one, that turn already owns the abort
        // ref, the cooldown and the status dot — a stale finally must not
        // null its controller or paint "watching" over its "teaching"/"error".
        if (teachingAbortRef.current === abort) {
          teachingAbortRef.current = null;
          cooldownUntilRef.current = Date.now() + PROACTIVE_COOLDOWN_MS;
          if (!turnFailed) {
            setJarvisPhase("watching");
          }
          if (transcriptTimerRef.current) {
            clearTimeout(transcriptTimerRef.current);
          }
          transcriptTimerRef.current = setTimeout(
            () => setCurrentTranscript(""),
            2000,
          );
        }
      }
    },
    [excalidrawAPI],
  );

  // -------------------------------------------------------------------------
  // Initialize monitor and voice when API is ready
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!excalidrawAPI) {
      setJarvisPhase("idle");
      return;
    }

    const monitor = new CanvasMonitor(excalidrawAPI);
    monitorRef.current = monitor;

    // Load memory from previous session (non-blocking)
    const spatialMemoryInst = getSpatialMemory();
    spatialMemoryInst.initFromStorage();

    // Save memory on page close/refresh
    const handleUnload = () => { spatialMemoryInst.saveToStorage(); };
    window.addEventListener("beforeunload", handleUnload);

    const voice = new VoiceMonitor({
      onTranscript: (t) => {
        if (!excalidrawAPI) return;
        // Skip low-confidence transcripts to prevent garbled speech from triggering AI.
        // confidence === 0 means the browser doesn't report confidence — pass through.
        if (t.confidence > 0 && t.confidence < MIN_VOICE_CONFIDENCE) return;
        const text = t.text.trim().toLowerCase();
        if (text === "stop" || text === "wait") {
          if (teachingAbortRef.current) teachingAbortRef.current.abort();
          setJarvisPhase("watching");
          return;
        }
        setCurrentTranscript(t.text);
        setJarvisPhase("listening");

        const appState = excalidrawAPI.getAppState();
        const selectedIds = appState?.selectedElementIds ?? {};
        const elements = excalidrawAPI.getSceneElements();
        const pointedSummary = monitor.getSelectedElementsSummary(
          selectedIds as Record<string, true>,
          elements,
        );
        const memory = getSpatialMemory();
        const pointedIds = Object.keys(selectedIds);
        const memoryContext =
          pointedIds.length > 0
            ? pointedIds
                .map((id) => memory.getRelevantContext(id))
                .filter(Boolean)
                .join("\n")
            : memory.getConversationContext();

        startTeaching({
          voice: t.text,
          pointedElement: pointedSummary || undefined,
          memory: memoryContext || undefined,
        });
      },
    });
    voiceMonitorRef.current = voice;
    // Listening is started/stopped by the mic-toggle effect below, so that
    // flipping the mic doesn't tear down the canvas monitor.
    setJarvisPhase("watching");

    return () => {
      voice.stop();
      voiceMonitorRef.current = null;
      monitorRef.current = null;
      workerQueueRef.current?.close();
      workerQueueRef.current = null;
      window.removeEventListener("beforeunload", handleUnload);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (transcriptTimerRef.current) {
        clearTimeout(transcriptTimerRef.current);
        transcriptTimerRef.current = null;
      }
    };
  }, [excalidrawAPI, startTeaching]);

  // -------------------------------------------------------------------------
  // Mic toggle: start/stop listening without recreating the monitors.
  // Runs after the init effect above, so voiceMonitorRef is already populated.
  // -------------------------------------------------------------------------

  useEffect(() => {
    const voice = voiceMonitorRef.current;
    if (!voice || !VoiceMonitor.isSupported()) return;

    if (micEnabled) {
      voice.start();
      return;
    }

    voice.stop();
    // Drop any in-flight transcript so the muted mic leaves no stale UI behind
    if (transcriptTimerRef.current) {
      clearTimeout(transcriptTimerRef.current);
      transcriptTimerRef.current = null;
    }
    setCurrentTranscript("");
    setJarvisPhase((phase) => (phase === "listening" ? "watching" : phase));
  }, [micEnabled, excalidrawAPI]);

  // -------------------------------------------------------------------------
  // Idle / proactive trigger: onChange debounce + background recognition
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!excalidrawAPI || !monitorRef.current) return;

    const onChange = () => {
      const monitor = monitorRef.current;
      if (!monitor) return;

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      monitor.updateFromAPI();

      // Samsung-style: fire background recognition while user is still drawing
      const recentChanges = monitor.getRecentChanges(5);
      const hasNewFreedraw = recentChanges.some(
        (c) => c.type === "added" && c.details.includes("Hand-drawn"),
      );
      if (hasNewFreedraw && !teachingAbortRef.current) {
        // Fire-and-forget — does not block the debounce timer
        captureAndRecognize(excalidrawAPI, recognitionCacheRef);
      }

      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        // Guard: never start a new teaching session while one is running
        if (teachingAbortRef.current) return;
        if (!monitor.hasNewUserContent() || !monitor.isSignificant()) return;
        if (Date.now() < cooldownUntilRef.current) return;
        startTeaching({
          content: monitor.getLatestUserContent(),
          intent: monitor.extractSpatialContext().userIntent,
        });
      }, IDLE_DEBOUNCE_MS);
    };

    const unsub = excalidrawAPI.onChange(onChange);
    return () => {
      unsub();
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [excalidrawAPI, startTeaching]);

  return { jarvisPhase, currentTranscript, jarvisError };
}
