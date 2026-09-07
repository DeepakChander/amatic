/**
 * Master Plan Type Definitions
 *
 * Types for the multi-AI visual generation system where Master AI
 * orchestrates 500+ workers with detailed context-rich instructions.
 */

export enum ContentType {
  SimpleConcept = "simple-concept",
  ScientificTheory = "scientific-theory",
  Mathematical = "mathematical",
  Philosophical = "philosophical",
  Historical = "historical",
  Technical = "technical",
}

export interface ContentClassification {
  type: ContentType;
  textRatio: number; // 0.08 to 0.45
  requiresEquations: boolean;
  requiresQuotes: boolean;
  confidence: number; // 0-1
}

export interface Concept {
  name: string;
  description: string;
  priority: 1 | 2 | 3; // 1 = immediate, 2 = supporting, 3 = detail
  importance: number; // 0-1
  relatedTo: number[]; // Task IDs of related concepts
  keywords: string[];
}

export interface VisualTask {
  taskId: number;
  concept: string;
  style: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  priority: 1 | 2 | 3;
  relatedTo: number[];
}

export interface DetailedWorkerBrief {
  // Identity
  workerId: number;
  taskId: number;
  concept: string;

  // Image generation via OpenRouter
  visualType?: "2d-standard" | "3d-style-2d" | "true-3d";
  selectedModel?: string; // 'nano-banana', 'nano-banana-pro', 'gpt-5-image-mini', 'flux-2-pro'
  imagePrompt?: string;
  negativePrompt?: string;

  // WHAT to generate (detailed description)
  educationalGoal: {
    whatToTeach: string;
    keyInsight: string;
    userUnderstanding: string;
  };

  visualRequirements: {
    mustShow: string[];
    visualMetaphor: string;
    emphasize: string;
    detailLevel: string;
  };

  // WHEN it appears (narrative integration)
  narrativeIntegration: {
    mentionedAt: string;
    voiceScript: string;
    highlightDuration: number;
    cameraAction: string;
    emotionAtThisPoint: string;
  };

  // HOW it connects (visual ecosystem)
  visualContext: {
    previousConcept: string;
    thisIsBuilding: string;
    nextConcept: string;
    showsProgressionFrom: string;
    partOfLargerStory: string;
  };

  connectionLines: Array<{
    toVisual: number;
    label: string;
    lineStyle: "solid" | "dashed" | "dotted";
    animated: boolean;
  }>;

  // STYLE coherence (all 500 must match)
  styleGuidelines: {
    colorScheme: string;
    primaryColors: string[];
    colorMeaning: Record<string, string>;
    illustrationStyle: string;
    background: "transparent";
    frameworkRequired: "framer-motion";
  };

  // Technical specs
  technicalConstraints: {
    position: { x: number; y: number };
    size: { width: number; height: number };
    priority: 1 | 2 | 3;
    timeout: number;
    noBackgroundColor: true;
  };

  // QUALITY requirements
  qualityRequirements: {
    minimumScore: number;
    mustHave: string[];
    avoidThese: string[];
  };

  // Examples
  examplesOfGood: string;
  examplesOfBad: string;
  referenceStyle: string;

  // Validation
  validationCriteria: {
    componentStructure: string;
    hasInteractivity: string;
    hasAnimation: string;
    educationalValue: string;
    codeQuality: string;
  };
}

export interface TextElement {
  id: string;
  type: "title" | "label" | "equation" | "definition" | "quote";
  content: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  style: {
    fontSize: number;
    fontWeight: string;
    color: string;
    backgroundColor?: string;
  };
  isLatex: boolean;
  highlightable: boolean;
}

export interface VoiceScript {
  fullScript: string;
  duration: number; // seconds
  segments: VoiceSegment[];
  emotionMarkers: EmotionMarker[];
}

export interface VoiceSegment {
  text: string;
  startTime: number;
  endTime: number;
  emotion: string;
  highlightVisuals: number[]; // Task IDs to highlight
  cameraPosition?: { x: number; y: number; zoom: number };
}

export interface EmotionMarker {
  timestamp: number;
  emotion:
    | "warm"
    | "excited"
    | "professional"
    | "curious"
    | "amazed"
    | "serious"
    | "calm"
    | "enthusiastic";
}

export interface HighlightTimeline {
  points: HighlightPoint[];
  duration: number;
}

export interface HighlightPoint {
  timestamp: number;
  elementIds: string[]; // Visual and/or text IDs
  action: "highlight" | "pulse" | "glow" | "dim-others";
  cameraPosition?: { x: number; y: number; zoom: number };
  duration: number; // How long to highlight
}

export type LayoutStrategy =
  | "grid"
  | "radial"
  | "hierarchical"
  | "narrative"
  | "mind-map";

export interface LayoutPlan {
  strategy: LayoutStrategy;
  positions: Array<{ x: number; y: number }>;
  canvasSize: { width: number; height: number };
  clusters?: Array<{ name: string; visualIds: number[] }>;
}

export interface MasterPlan {
  query: string;
  contentType: ContentType;
  totalVisuals: number;
  textRatio: number;
  workerBriefs: DetailedWorkerBrief[];
  textElements: TextElement[];
  voiceScript: VoiceScript;
  timeline: HighlightTimeline;
  layout: LayoutPlan;
  estimatedDuration: number;
  createdAt: number;
}

export interface VisualResult {
  taskId: number;
  type?: "2d-image" | "3d-model";
  imageUrl?: string; // For 2D images
  modelUrl?: string; // For 3D models
  component?: string; // Legacy React components
  concept?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  quality: number;
  model?: string;
  status: "success" | "error" | "retry";
  error?: string;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface GenerationProgress {
  completed: number;
  total: number;
  percentage: number;
  currentPhase: "planning" | "generating" | "narrating" | "complete";
  estimatedTimeRemaining: number;
}

export default {
  ContentType,
};
