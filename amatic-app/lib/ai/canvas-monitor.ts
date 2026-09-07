/**
 * Canvas Monitor - Real-Time Spatial Context Tracking
 *
 * Watches canvas changes and builds rich spatial context:
 * - Tool awareness (active tool, pen mode)
 * - Zone grid (which areas of the canvas are empty vs filled)
 * - Rich element descriptions (color, font, connections)
 * - Full bounds including AI-written elements
 * NO screenshots — just intelligent metadata extraction
 */

import type { ExcalidrawImperativeAPI } from "@amatic/amatic/types";
import type { NonDeletedExcalidrawElement } from "@amatic/element/types";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ToolContext {
  activeTool: string;
  toolLocked: boolean;
  penMode: boolean;
  recentToolUsage: string;
}

export interface CanvasZone {
  row: number;
  col: number;
  /** Top-left X in screen pixels */
  x: number;
  /** Top-left Y in screen pixels */
  y: number;
  w: number;
  h: number;
}

export interface CanvasZoneMap {
  /** ROWS × COLS grid where each cell is "filled" | "ai" | "empty" */
  grid: string[][];
  /** Empty cells sorted top-left first (best placement candidates) */
  freeCells: CanvasZone[];
  /** Human-readable summary for the AI prompt */
  summary: string;
}

export interface SpatialContext {
  elements: ElementDescription[];
  changes: ChangeDescription[];
  timestamp: number;
  userIntent: string;
  toolInfo: ToolContext;
  canvasZones: CanvasZoneMap;
  viewport: {
    scrollX: number;
    scrollY: number;
    zoom: number;
    width: number;
    height: number;
  };
  elementStats: {
    total: number;
    byType: Record<string, number>;
    userCount: number;
    aiCount: number;
  };
}

export interface ElementDescription {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  content?: string;
  style?: string;
  creator: "user" | "ai";
}

export interface ChangeDescription {
  type: "added" | "modified" | "deleted";
  elementId: string;
  timestamp: number;
  details: string;
}

export interface UserContentBounds {
  x: number;
  y: number;
  maxX: number;
  maxY: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZONE_COLS = 6;
const ZONE_ROWS = 4;

// ---------------------------------------------------------------------------
// CanvasMonitor
// ---------------------------------------------------------------------------

export class CanvasMonitor {
  private previousElements: NonDeletedExcalidrawElement[] = [];
  private changes: ChangeDescription[] = [];
  private api: ExcalidrawImperativeAPI;
  private hasNewUserContentSinceTeaching = false;

  constructor(api: ExcalidrawImperativeAPI) {
    this.api = api;
  }

  // -------------------------------------------------------------------------
  // Public: onChange sync
  // -------------------------------------------------------------------------

  updateFromAPI(): void {
    const elements = this.api.getSceneElements();
    this.detectChanges(elements);
  }

  // -------------------------------------------------------------------------
  // Public: Full spatial context (main entry point for Jarvis)
  // -------------------------------------------------------------------------

  extractSpatialContext(): SpatialContext {
    const elements = this.api.getSceneElements();
    const state = this.api.getAppState();
    const descriptions: ElementDescription[] = [];

    const byType: Record<string, number> = {};
    let userCount = 0;
    let aiCount = 0;

    for (const el of elements) {
      byType[el.type] = (byType[el.type] ?? 0) + 1;
      const isAI = el.id.startsWith("ai-");
      if (isAI) aiCount++; else userCount++;

      descriptions.push({
        id: el.id,
        type: el.type,
        position: { x: Math.round(el.x), y: Math.round(el.y) },
        size: { width: Math.round(el.width), height: Math.round(el.height) },
        content: "text" in el ? (el as any).text : undefined,
        style: this.describeStyle(el),
        creator: isAI ? "ai" : "user",
      });
    }

    this.detectChanges(elements);
    const userIntent = this.inferUserIntent();

    return {
      elements: descriptions,
      changes: this.changes.slice(-10),
      timestamp: Date.now(),
      userIntent,
      toolInfo: this.getToolContext(),
      canvasZones: this.getCanvasZoneMap(),
      viewport: {
        scrollX: Math.round(state.scrollX),
        scrollY: Math.round(state.scrollY),
        zoom: state.zoom.value,
        width: state.width,
        height: state.height,
      },
      elementStats: {
        total: elements.length,
        byType,
        userCount,
        aiCount,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Public: Tool context
  // -------------------------------------------------------------------------

  getToolContext(): ToolContext {
    const state = this.api.getAppState();
    const tool = state.activeTool.type;
    const recentFreedraw = this.changes
      .slice(-5)
      .filter((c) => c.details.includes("Hand-drawn")).length;

    return {
      activeTool: tool,
      toolLocked: state.activeTool.locked,
      penMode: state.penMode,
      recentToolUsage: this.describeToolUsage(tool, recentFreedraw),
    };
  }

  // -------------------------------------------------------------------------
  // Public: Canvas zone map (free-space detection)
  // -------------------------------------------------------------------------

  getCanvasZoneMap(): CanvasZoneMap {
    const state = this.api.getAppState();
    const { width, height, scrollX, scrollY } = state;
    const zoom = state.zoom.value;
    const cellW = width / ZONE_COLS;
    const cellH = height / ZONE_ROWS;

    // Initialize grid to "empty"
    const grid: string[][] = Array.from({ length: ZONE_ROWS }, () =>
      Array(ZONE_COLS).fill("empty"),
    );

    // Mark cells that contain elements
    for (const el of this.api.getSceneElements()) {
      // Convert scene coordinates to screen coordinates
      // In Excalidraw: screenX = sceneX * zoom + scrollX (scrollX is in screen px)
      const screenX = el.x * zoom + scrollX;
      const screenY = el.y * zoom + scrollY;
      const screenX2 = (el.x + el.width) * zoom + scrollX;
      const screenY2 = (el.y + el.height) * zoom + scrollY;

      // Mark all cells the element overlaps
      const colStart = Math.max(0, Math.floor(screenX / cellW));
      const colEnd = Math.min(ZONE_COLS - 1, Math.floor(screenX2 / cellW));
      const rowStart = Math.max(0, Math.floor(screenY / cellH));
      const rowEnd = Math.min(ZONE_ROWS - 1, Math.floor(screenY2 / cellH));

      const mark = el.id.startsWith("ai-") ? "ai" : "filled";
      for (let r = rowStart; r <= rowEnd; r++) {
        for (let c = colStart; c <= colEnd; c++) {
          // "filled" takes priority over "ai"
          if (grid[r][c] !== "filled") {
            grid[r][c] = mark;
          }
        }
      }
    }

    // Build free cells list (sorted top-left first)
    const freeCells: CanvasZone[] = [];
    for (let r = 0; r < ZONE_ROWS; r++) {
      for (let c = 0; c < ZONE_COLS; c++) {
        if (grid[r][c] === "empty") {
          freeCells.push({
            row: r,
            col: c,
            x: c * cellW,
            y: r * cellH,
            w: cellW,
            h: cellH,
          });
        }
      }
    }

    const summary = this.buildZoneSummary(grid, freeCells.length);

    return { grid, freeCells, summary };
  }

  // -------------------------------------------------------------------------
  // Public: Bounds
  // -------------------------------------------------------------------------

  /**
   * Bounding box of user-only elements (for content detection).
   */
  getUserContentBounds(): UserContentBounds {
    const elements = this.api
      .getSceneElements()
      .filter((el) => !el.id.startsWith("ai-"));
    return this.calcBounds(elements);
  }

  /**
   * Bounding box of ALL elements including AI-written ones.
   * Use this for placement so AI text is never overwritten.
   */
  getAllElementsBounds(): UserContentBounds {
    const elements = this.api.getSceneElements();
    return this.calcBounds(elements);
  }

  private calcBounds(
    elements: readonly NonDeletedExcalidrawElement[],
  ): UserContentBounds {
    if (elements.length === 0) {
      return { x: 0, y: 0, maxX: 0, maxY: 0 };
    }
    let x = Infinity,
      y = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const el of elements) {
      const right = el.x + el.width;
      const bottom = el.y + el.height;
      if (el.x < x) x = el.x;
      if (el.y < y) y = el.y;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
    return { x, y, maxX, maxY };
  }

  // -------------------------------------------------------------------------
  // Public: Content helpers
  // -------------------------------------------------------------------------

  getLatestUserContent(): string {
    const elements = this.api.getSceneElements();
    const parts: string[] = [];
    for (const el of elements) {
      if (el.id.startsWith("ai-")) continue;
      if (el.type === "text" && "text" in el && (el as any).text) {
        parts.push((el as any).text);
      } else {
        parts.push(this.describeElement(el));
      }
    }
    return parts.join(" ");
  }

  /**
   * Detect the primary language of text on the canvas using Unicode range heuristics.
   * Returns a BCP-47 language tag (e.g. "en-US", "ar-SA", "zh-CN").
   * Falls back to "en-US" when no text is found or when text is ambiguously Latin.
   */
  detectLanguage(): string {
    const text = this.getLatestUserContent();
    if (!text || text.length < 3) return "en-US";

    const checks: [RegExp, string][] = [
      [/[\u0600-\u06FF]/, "ar-SA"],     // Arabic
      [/[\u4E00-\u9FFF]/, "zh-CN"],     // Chinese (CJK unified ideographs)
      [/[\u3040-\u309F\u30A0-\u30FF]/, "ja-JP"], // Japanese (hiragana/katakana)
      [/[\uAC00-\uD7AF]/, "ko-KR"],     // Korean (Hangul)
      [/[\u0400-\u04FF]/, "ru-RU"],     // Cyrillic (Russian)
      [/[\u0590-\u05FF]/, "he-IL"],     // Hebrew
      [/[\u0900-\u097F]/, "hi-IN"],     // Devanagari (Hindi)
      [/[\u0E00-\u0E7F]/, "th-TH"],     // Thai
    ];

    for (const [pattern, lang] of checks) {
      if (pattern.test(text)) return lang;
    }

    // Latin-script language detection via common function words
    const lower = text.toLowerCase();
    if (/\b(el|la|los|las|que|por|con|una|como|más|pero|¿|¡)\b/.test(lower)) return "es-ES";
    if (/\b(le|la|les|des|une|pour|avec|dans|que|est|c'est|être)\b/.test(lower)) return "fr-FR";
    if (/\b(der|die|das|und|oder|nicht|ist|sind|wird|wie|aber|über)\b/.test(lower)) return "de-DE";
    if (/\b(il|la|le|di|che|non|un|una|per|sono|con|come)\b/.test(lower)) return "it-IT";
    if (/\b(o|a|os|as|de|do|da|para|com|como|que|não|por)\b/.test(lower)) return "pt-BR";

    return "en-US";
  }

  hasNewUserContent(): boolean {
    return this.hasNewUserContentSinceTeaching;
  }

  markTeachingComplete(): void {
    this.hasNewUserContentSinceTeaching = false;
    // Prune old changes to prevent unbounded growth
    if (this.changes.length > 200) {
      this.changes = this.changes.slice(-100);
    }
  }

  getElementNearPoint(
    pointX: number,
    pointY: number,
    radius: number,
  ): ElementDescription | null {
    const elements = this.api.getSceneElements();
    let best: { el: NonDeletedExcalidrawElement; dist: number } | null = null;
    for (const el of elements) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const dist = Math.hypot(pointX - cx, pointY - cy);
      const inBox =
        pointX >= el.x &&
        pointX <= el.x + el.width &&
        pointY >= el.y &&
        pointY <= el.y + el.height;
      if (dist <= radius || inBox) {
        if (!best || dist < best.dist) {
          best = { el, dist };
        }
      }
    }
    if (!best) return null;
    const el = best.el;
    return {
      id: el.id,
      type: el.type,
      position: { x: el.x, y: el.y },
      size: { width: el.width, height: el.height },
      content: "text" in el ? (el as any).text : undefined,
      creator: el.id.startsWith("ai-") ? "ai" : "user",
    };
  }

  getSelectedElementsSummary(
    selectedIds: Record<string, true>,
    elements?: readonly NonDeletedExcalidrawElement[],
  ): string {
    const els = elements ?? this.api.getSceneElements();
    const ids = Object.keys(selectedIds);
    if (ids.length === 0) return "";
    const parts: string[] = [];
    for (const id of ids) {
      const el = els.find((e) => e.id === id);
      if (el) parts.push(this.describeElement(el));
    }
    return parts.join("; ");
  }

  isSignificant(): boolean {
    const recentAddedIds = this.changes
      .slice(-10)
      .filter((c) => c.type === "added")
      .map((c) => c.elementId);
    const current = this.api.getSceneElements();
    const userAdded = current.filter(
      (e) => recentAddedIds.includes(e.id) && !e.id.startsWith("ai-"),
    );
    if (userAdded.length >= 2) return true;
    if (userAdded.some((e) => e.type === "text")) return true;
    if (
      userAdded.some(
        (e) => e.type === "freedraw" && e.width >= 50 && e.height >= 50,
      )
    )
      return true;
    return false;
  }

  /**
   * Returns the most recent change records. Used by useCanvasJarvis to detect
   * new freedraw elements for background recognition.
   */
  getRecentChanges(count = 5): ChangeDescription[] {
    return this.changes.slice(-count);
  }

  needsVisionForHandwriting(): boolean {
    const recentChanges = this.changes.slice(-3);
    const hasFreedraw = recentChanges.some((c) =>
      c.details.includes("Hand-drawn"),
    );
    const hasQuestionContext = recentChanges.some((c) =>
      c.details.includes("?"),
    );
    return hasFreedraw && hasQuestionContext;
  }

  // -------------------------------------------------------------------------
  // Private: Change detection
  // -------------------------------------------------------------------------

  private detectChanges(
    currentElements: readonly NonDeletedExcalidrawElement[],
  ) {
    const prevIds = new Set(this.previousElements.map((el) => el.id));

    for (const el of currentElements) {
      if (!prevIds.has(el.id)) {
        if (!el.id.startsWith("ai-")) {
          this.hasNewUserContentSinceTeaching = true;
        }
        this.changes.push({
          type: "added",
          elementId: el.id,
          timestamp: Date.now(),
          details: this.describeElement(el),
        });
      }
    }

    const currIds = new Set(currentElements.map((el) => el.id));
    for (const el of this.previousElements) {
      if (!currIds.has(el.id)) {
        this.changes.push({
          type: "deleted",
          elementId: el.id,
          timestamp: Date.now(),
          details: `Removed ${el.type}`,
        });
      }
    }

    this.previousElements = [...currentElements];
  }

  // -------------------------------------------------------------------------
  // Private: Rich element description
  // -------------------------------------------------------------------------

  describeElement(el: NonDeletedExcalidrawElement): string {
    const x = Math.round(el.x);
    const y = Math.round(el.y);
    const w = Math.round(el.width);
    const h = Math.round(el.height);
    const e = el as any;

    switch (el.type) {
      case "text": {
        const text = e.text ?? "";
        const fontSize = e.fontSize ?? 20;
        return `Text: "${text.slice(0, 80)}" at (${x}, ${y}), font: ${fontSize}px`;
      }
      case "freedraw":
        return `Hand-drawn strokes ${w}×${h} at (${x}, ${y}), stroke: ${e.strokeColor ?? "default"}`;
      case "rectangle":
        return `Rectangle ${w}×${h} at (${x}, ${y}), stroke: ${e.strokeColor ?? "default"}, fill: ${e.backgroundColor || "none"}, opacity: ${e.opacity ?? 100}%`;
      case "diamond":
        return `Diamond ${w}×${h} at (${x}, ${y}), stroke: ${e.strokeColor ?? "default"}, fill: ${e.backgroundColor || "none"}`;
      case "ellipse":
        return `Ellipse ${w}×${h} at (${x}, ${y}), stroke: ${e.strokeColor ?? "default"}, fill: ${e.backgroundColor || "none"}`;
      case "arrow": {
        const from = e.startBinding
          ? `from element ${e.startBinding.elementId}`
          : "from canvas";
        const to = e.endBinding
          ? `to element ${e.endBinding.elementId}`
          : "to canvas";
        return `Arrow ${from} ${to} at (${x}, ${y})`;
      }
      case "line":
        return `Line ${w}×${h} at (${x}, ${y}), stroke: ${e.strokeColor ?? "default"}`;
      case "image":
        return `Image ${w}×${h} at (${x}, ${y})`;
      case "frame":
        return `Frame ${w}×${h} at (${x}, ${y}), name: ${e.name ?? "unnamed"}`;
      default:
        return `${el.type} ${w}×${h} at (${x}, ${y})`;
    }
  }

  private describeStyle(el: NonDeletedExcalidrawElement): string {
    const e = el as any;
    const parts: string[] = [];
    if (e.strokeColor && e.strokeColor !== "#000000")
      parts.push(`stroke:${e.strokeColor}`);
    if (e.backgroundColor && e.backgroundColor !== "transparent")
      parts.push(`fill:${e.backgroundColor}`);
    if (e.opacity !== undefined && e.opacity !== 100)
      parts.push(`opacity:${e.opacity}%`);
    if (e.fontSize) parts.push(`font:${e.fontSize}px`);
    return parts.join(", ");
  }

  // -------------------------------------------------------------------------
  // Private: Tool description
  // -------------------------------------------------------------------------

  private describeToolUsage(tool: string, recentFreedrawCount: number): string {
    switch (tool) {
      case "freedraw":
        return `Student is drawing freehand (${recentFreedrawCount} recent strokes) — likely sketching shapes or equations`;
      case "text":
        return "Student is about to type text — may be writing a question or label";
      case "selection":
        return "Student is selecting/reviewing elements — may want explanation of selected items";
      case "lasso":
        return "Student is lasso-selecting a group of elements";
      case "eraser":
        return "Student is erasing — they may be correcting something or starting fresh";
      case "arrow":
        return "Student is drawing arrows — connecting concepts or showing relationships";
      case "rectangle":
        return "Student is drawing a rectangle — possibly a diagram box or container";
      case "diamond":
        return "Student is drawing a diamond — possibly a flowchart decision node";
      case "ellipse":
        return "Student is drawing an ellipse/circle — possibly a diagram node";
      case "line":
        return "Student is drawing a line — possibly a diagram connector";
      case "image":
        return "Student is inserting an image";
      case "hand":
        return "Student is panning the canvas — navigating around their work";
      case "laser":
        return "Student is using the laser pointer — presenting or highlighting";
      case "frame":
        return "Student is creating a frame/section on the canvas";
      default:
        return `Student is using the ${tool} tool`;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Zone summary
  // -------------------------------------------------------------------------

  private buildZoneSummary(grid: string[][], freeCount: number): string {
    const total = ZONE_ROWS * ZONE_COLS;
    const filledCount = grid
      .flat()
      .filter((c) => c === "filled").length;
    const aiCount = grid.flat().filter((c) => c === "ai").length;

    if (freeCount === total) {
      return "Canvas is completely empty — place content anywhere.";
    }
    if (freeCount === 0) {
      return "Canvas is fully occupied — extend content below the existing area.";
    }

    // Describe which quadrants are free
    const quadrants: string[] = [];
    const halfRows = Math.floor(ZONE_ROWS / 2);
    const halfCols = Math.floor(ZONE_COLS / 2);

    const quadrantFree = (rowStart: number, rowEnd: number, colStart: number, colEnd: number) =>
      grid.slice(rowStart, rowEnd).some((row) =>
        row.slice(colStart, colEnd).some((c) => c === "empty"),
      );

    if (quadrantFree(0, halfRows, 0, halfCols)) quadrants.push("top-left");
    if (quadrantFree(0, halfRows, halfCols, ZONE_COLS)) quadrants.push("top-right");
    if (quadrantFree(halfRows, ZONE_ROWS, 0, halfCols)) quadrants.push("bottom-left");
    if (quadrantFree(halfRows, ZONE_ROWS, halfCols, ZONE_COLS)) quadrants.push("bottom-right");

    const gridText = grid
      .map((row) =>
        row.map((c) => (c === "empty" ? "□" : c === "ai" ? "▪" : "■")).join(""),
      )
      .join(" | ");

    return (
      `${freeCount}/${total} cells free. ` +
      `User content: ${filledCount} cells. AI content: ${aiCount} cells. ` +
      `Free quadrants: ${quadrants.join(", ") || "none"}. ` +
      `Grid (□=empty ▪=AI ■=user): ${gridText}`
    );
  }

  // -------------------------------------------------------------------------
  // Private: Intent inference (enhanced with tool awareness)
  // -------------------------------------------------------------------------

  private inferUserIntent(): string {
    if (this.changes.length === 0) {
      return "idle";
    }

    const state = this.api.getAppState();
    const tool = state.activeTool.type;

    // Tool-based intent (highest priority)
    if (tool === "eraser") return "erasing_correcting";
    if (tool === "laser") return "presenting_highlighting";

    const recent = this.changes.slice(-5);
    const details = recent.map((c) => c.details);

    if (details.some((t) => t.includes("Text:") && t.includes("?"))) {
      return "asking_question";
    }
    if (details.some((t) => t.includes("Hand-drawn")) || tool === "freedraw") {
      return "drawing";
    }
    if (
      details.some((t) => t.includes("Arrow")) ||
      tool === "arrow"
    ) {
      return "connecting_concepts";
    }
    if (recent.length >= 3) {
      return "actively_creating";
    }
    if (tool === "selection" || tool === "lasso") {
      return "reviewing_selecting";
    }

    return "exploring";
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCanvasMonitor(
  api: ExcalidrawImperativeAPI,
): CanvasMonitor {
  return new CanvasMonitor(api);
}
