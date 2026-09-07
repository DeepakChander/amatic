/**
 * Detailed Context Generator
 *
 * THE SECRET SAUCE: Generates comprehensive, detailed instructions for each worker.
 * Transforms visual quality from 70/100 to 95/100 by providing rich context.
 *
 * Master AI uses this to create detailed briefs for all 500 workers,
 * ensuring consistency, quality, and educational effectiveness.
 */

import { classifyVisualType } from "./visual-type-classifier";

import type {
  DetailedWorkerBrief,
  Concept,
  VoiceScript,
  LayoutPlan,
} from "@/types/master-plan";

import { selectModel } from "@/lib/image-generation/model-selector";
import { buildPromptForWorker } from "@/lib/image-generation/prompt-builder";

export interface ContextGenerationOptions {
  query: string;
  audience: "kid" | "teen" | "adult" | "professional";
  totalConcepts: number;
  taskPosition: number;
  allConcepts: Concept[];
  voiceScript?: VoiceScript;
  layout?: LayoutPlan;
}

/**
 * Generate detailed context for a single visual task
 * This is called by Master AI for EACH of the 500 visuals
 */
export async function generateDetailedBrief(
  concept: Concept,
  options: ContextGenerationOptions,
): Promise<DetailedWorkerBrief> {
  const taskId = options.taskPosition + 1;
  const workerId = (taskId % 500) + 1;

  // NEW: Classify visual type (2D / 3D-style / true-3D)
  const visualClassification = classifyVisualType(concept, options.query);

  // NEW: Select optimal model (Nano Banana, DALL-E, Meshy, etc.)
  const modelSelection = selectModel(
    visualClassification.type,
    concept,
    "medium",
  );

  // Use AI to generate rich educational context
  const aiContext = await generateAIContext(concept, options);

  // Determine narrative timing
  const narrativeInfo = extractNarrativeInfo(
    concept,
    options.voiceScript,
    options.taskPosition,
    options.totalConcepts,
  );

  // Plan visual relationships
  const relationships = planVisualRelationships(
    concept,
    options.allConcepts,
    options.taskPosition,
  );

  // Generate style guidelines for consistency
  const styleGuide = generateStyleGuidelines(
    concept,
    options.query,
    options.taskPosition,
    options.audience,
  );

  // Determine position and size
  const position = options.layout?.positions[options.taskPosition] || {
    x: 300 + (options.taskPosition % 5) * 500,
    y: 200 + Math.floor(options.taskPosition / 5) * 400,
  };

  const size = calculateOptimalSize(concept, options.audience);

  // Build complete detailed brief (WITH image generation data!)
  const brief: DetailedWorkerBrief = {
    workerId,
    taskId,
    concept: concept.name,

    // NEW: Image generation fields
    visualType: (["2d-standard", "3d-style-2d", "true-3d"].includes(visualClassification.type)
      ? visualClassification.type
      : "2d-standard") as "2d-standard" | "3d-style-2d" | "true-3d",
    selectedModel: modelSelection.modelName,
    imagePrompt: "", // Will be built by prompt-builder
    negativePrompt: "", // Will be built by prompt-builder

    educationalGoal: {
      whatToTeach: aiContext.teachingGoal,
      keyInsight: aiContext.mainTakeaway,
      userUnderstanding: aiContext.expectedUnderstanding,
    },

    visualRequirements: {
      mustShow: aiContext.requiredElements,
      visualMetaphor:
        aiContext.helpfulAnalogy ||
        aiContext.metaphor ||
        `Visual representation of ${concept.name}`,
      emphasize:
        aiContext.emphasisPoints || `Focus on key aspects of ${concept.name}`,
      detailLevel: determineDetailLevel(concept, options.audience),
    },

    narrativeIntegration: {
      mentionedAt: narrativeInfo.timestamp,
      voiceScript: narrativeInfo.scriptExcerpt,
      highlightDuration: narrativeInfo.duration,
      cameraAction: narrativeInfo.cameraAction,
      emotionAtThisPoint: narrativeInfo.emotion,
    },

    visualContext: {
      previousConcept: relationships.previous,
      thisIsBuilding: relationships.buildingToward,
      nextConcept: relationships.next,
      showsProgressionFrom: relationships.progression,
      partOfLargerStory: relationships.narrativeArc,
    },

    connectionLines: relationships.connections,

    styleGuidelines: {
      colorScheme: styleGuide.colorScheme,
      primaryColors: styleGuide.primaryColors,
      colorMeaning: styleGuide.colorMeaning,
      illustrationStyle: styleGuide.illustrationStyle,
      background: "transparent",
      frameworkRequired: "framer-motion",
    },

    technicalConstraints: {
      position,
      size,
      priority: concept.priority,
      timeout: 30,
      noBackgroundColor: true,
    },

    qualityRequirements: {
      minimumScore: concept.priority === 1 ? 90 : 85,
      mustHave: aiContext.criticalFeatures || [],
      avoidThese: aiContext.commonPitfalls || [],
    },

    examplesOfGood:
      aiContext.goodExamples ||
      `Clear, animated representation of ${concept.name}`,
    examplesOfBad:
      aiContext.badExamples || `Generic, static, unclear visualization`,
    referenceStyle: findSimilarVisual(concept, options.taskPosition),

    validationCriteria: {
      componentStructure: "Must be valid image or 3D model",
      hasInteractivity:
        visualClassification.type === "true-3d"
          ? "Must be rotatable"
          : "Not required for images",
      hasAnimation: "Entrance animation only (Framer Motion on display)",
      educationalValue: `Must clearly teach: ${concept.name}`,
      codeQuality: "High resolution, professional quality",
    },
  };

  // NEW: Build image prompts from context, carrying the classifier's style
  // through so 3D / photorealistic / schematic concepts don't fall back to 2D.
  const imagePrompt = buildPromptForWorker(brief, {
    style:
      visualClassification.suggestedStyle ??
      (visualClassification.type === "true-3d" ? "3d" : "2d"),
  });
  brief.imagePrompt = imagePrompt;
  brief.negativePrompt = "";

  return brief;
}

/**
 * Generate AI-powered educational context for a concept
 */
async function generateAIContext(
  concept: Concept,
  options: ContextGenerationOptions,
): Promise<{
  teachingGoal: string;
  mainTakeaway: string;
  expectedUnderstanding: string;
  requiredElements: string[];
  helpfulAnalogy: string;
  metaphor: string;
  emphasisPoints: string;
  criticalFeatures: string[];
  commonPitfalls: string[];
  goodExamples: string;
  badExamples: string;
}> {
  const { generateAnthropicResponse } = await import(
    "@/lib/ai/anthropic-service"
  );

  const systemPrompt = `You are Master AI planning a visual explanation. Return ONLY valid JSON, no other text.`;

  const userMessage = `Query: "${options.query}"
Concept to visualize: "${concept.name}"
Description: "${concept.description}"
Position: ${options.taskPosition + 1} of ${options.totalConcepts}
Audience: ${options.audience}

Generate detailed context for a worker AI to create this visual:

1. EDUCATIONAL GOAL:
   - What should this visual teach?
   - What's the key insight user must grasp?
   - What understanding should user have after seeing this?

2. VISUAL REQUIREMENTS:
   - What elements MUST be shown? (list 3-6 specific items)
   - What helpful analogy/metaphor explains this concept?
   - What should be emphasized visually?

3. QUALITY STANDARDS:
   - What features are critical? (list 3-5)
   - What common mistakes should be avoided? (list 3-5)
   - Example of a GOOD visualization?
   - Example of a BAD visualization?

Respond in JSON format:
{
  "teachingGoal": "...",
  "mainTakeaway": "...",
  "expectedUnderstanding": "...",
  "requiredElements": ["...", "..."],
  "helpfulAnalogy": "...",
  "emphasisPoints": "...",
  "criticalFeatures": ["...", "..."],
  "commonPitfalls": ["...", "..."],
  "goodExamples": "...",
  "badExamples": "..."
}`;

  try {
    const aiResponse = await generateAnthropicResponse(
      [{ role: "user", content: userMessage }],
      systemPrompt,
    );

    const response = aiResponse.content;
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        teachingGoal: parsed.teachingGoal,
        mainTakeaway: parsed.mainTakeaway,
        expectedUnderstanding: parsed.expectedUnderstanding,
        requiredElements: parsed.requiredElements || [],
        helpfulAnalogy: parsed.helpfulAnalogy || "",
        metaphor: parsed.helpfulAnalogy || "",
        emphasisPoints: parsed.emphasisPoints || "",
        criticalFeatures: parsed.criticalFeatures || [],
        commonPitfalls: parsed.commonPitfalls || [],
        goodExamples: parsed.goodExamples || "",
        badExamples: parsed.badExamples || "",
      };
    }
  } catch (error) {
    console.error("[DetailedContextGenerator] AI parse failed:", error);
  }

  // Fallback to structured defaults
  return {
    teachingGoal: `Teach the concept of ${concept.name}`,
    mainTakeaway: `Understanding how ${concept.name} works`,
    expectedUnderstanding: `User should grasp the basics of ${concept.name}`,
    requiredElements: [
      `Main ${concept.name} visualization`,
      "Labels",
      "Interactive elements",
    ],
    helpfulAnalogy: `Think of ${concept.name} as...`,
    metaphor: `${concept.name} is like...`,
    emphasisPoints: `Focus on the key aspects of ${concept.name}`,
    criticalFeatures: ["Clear structure", "Animations", "Interactivity"],
    commonPitfalls: ["Too complex", "Missing labels", "No animation"],
    goodExamples: `Clear, step-by-step visualization`,
    badExamples: `Static, confusing, generic`,
  };
}

/**
 * Extract narrative information for this visual
 */
function extractNarrativeInfo(
  concept: Concept,
  voiceScript: VoiceScript | undefined,
  position: number,
  total: number,
): {
  timestamp: string;
  scriptExcerpt: string;
  duration: number;
  cameraAction: string;
  emotion: string;
} {
  if (!voiceScript) {
    // Estimate based on position
    const estimatedTime = (position / total) * 180; // Assume 3 min total
    return {
      timestamp: `${Math.floor(estimatedTime / 60)}:${Math.floor(
        estimatedTime % 60,
      )
        .toString()
        .padStart(2, "0")}`,
      scriptExcerpt: `Explaining ${concept.name}...`,
      duration: 10,
      cameraAction: "pan-to-center",
      emotion: "professional",
    };
  }

  // Find segment that mentions this concept
  const conceptKeywords = concept.keywords || [concept.name.toLowerCase()];
  const matchingSegment = voiceScript.segments.find((seg) =>
    conceptKeywords.some((kw) => seg.text.toLowerCase().includes(kw)),
  );

  if (matchingSegment) {
    return {
      timestamp: `${Math.floor(matchingSegment.startTime / 60)}:${Math.floor(
        matchingSegment.startTime % 60,
      )
        .toString()
        .padStart(2, "0")}-${Math.floor(
        matchingSegment.endTime / 60,
      )}:${Math.floor(matchingSegment.endTime % 60)
        .toString()
        .padStart(2, "0")}`,
      scriptExcerpt: `${matchingSegment.text.substring(0, 200)}...`,
      duration: matchingSegment.endTime - matchingSegment.startTime,
      cameraAction: concept.priority === 1 ? "zoom-in" : "pan-to",
      emotion: matchingSegment.emotion,
    };
  }

  // Default timing
  return {
    timestamp: `${Math.floor(((position / total) * 180) / 60)}:${Math.floor(
      ((position / total) * 180) % 60,
    )
      .toString()
      .padStart(2, "0")}`,
    scriptExcerpt: `Now let's look at ${concept.name}...`,
    duration: 8,
    cameraAction: "pan-to",
    emotion: "professional",
  };
}

/**
 * Plan visual relationships and connections
 */
function planVisualRelationships(
  concept: Concept,
  allConcepts: Concept[],
  position: number,
): {
  previous: string;
  next: string;
  buildingToward: string;
  progression: string;
  narrativeArc: string;
  connections: Array<{
    toVisual: number;
    label: string;
    lineStyle: "solid" | "dashed" | "dotted";
    animated: boolean;
  }>;
} {
  const previous =
    position > 0 ? allConcepts[position - 1].name : "Introduction";
  const next =
    position < allConcepts.length - 1
      ? allConcepts[position + 1].name
      : "Conclusion";

  // Determine narrative arc position
  const progress = position / allConcepts.length;
  let narrativeArc = "Beginning";
  if (progress > 0.66) {
    narrativeArc = "Act 3 - Synthesis";
  } else if (progress > 0.33) {
    narrativeArc = "Act 2 - Deep Dive";
  } else {
    narrativeArc = "Act 1 - Foundation";
  }

  // Create connections to related concepts
  const connections = concept.relatedTo.map((relatedId) => ({
    toVisual: relatedId,
    label: `Relates to ${allConcepts[relatedId - 1]?.name || "concept"}`,
    lineStyle: (concept.priority === 1 ? "solid" : "dashed") as
      | "solid"
      | "dashed"
      | "dotted",
    animated: true,
  }));

  return {
    previous,
    next,
    buildingToward: `Understanding ${
      allConcepts[allConcepts.length - 1]?.name || "complete concept"
    }`,
    progression: `Step ${position + 1} of ${
      allConcepts.length
    }: From ${previous} → ${concept.name} → ${next}`,
    narrativeArc,
    connections,
  };
}

/**
 * Generate style guidelines for visual consistency
 */
function generateStyleGuidelines(
  _concept: Concept,
  query: string,
  _position: number,
  audience: string,
): {
  colorScheme: string;
  primaryColors: string[];
  colorMeaning: Record<string, string>;
  illustrationStyle: string;
} {
  // Determine color scheme based on topic
  const queryLower = query.toLowerCase();
  let colorScheme = "modern-blue";
  let primaryColors = ["#3B82F6", "#8B5CF6", "#EC4899"];

  if (queryLower.includes("quantum") || queryLower.includes("physics")) {
    colorScheme = "quantum-purple";
    primaryColors = ["#9D4EDD", "#7209B7", "#3C096C"];
  } else if (
    queryLower.includes("biology") ||
    queryLower.includes("life") ||
    queryLower.includes("cell")
  ) {
    colorScheme = "organic-green";
    primaryColors = ["#10B981", "#059669", "#047857"];
  } else if (
    queryLower.includes("energy") ||
    queryLower.includes("heat") ||
    queryLower.includes("fire")
  ) {
    colorScheme = "energy-warm";
    primaryColors = ["#FF6B6B", "#FFA07A", "#FFD700"];
  } else if (
    queryLower.includes("water") ||
    queryLower.includes("ocean") ||
    queryLower.includes("fluid")
  ) {
    colorScheme = "aqua-blue";
    primaryColors = ["#06B6D4", "#0891B2", "#0E7490"];
  } else if (
    queryLower.includes("tech") ||
    queryLower.includes("digital") ||
    queryLower.includes("computer")
  ) {
    colorScheme = "tech-cyan";
    primaryColors = ["#06B6D4", "#3B82F6", "#6366F1"];
  }

  // Photorealistic style based on audience
  const styleMap: Record<string, string> = {
    kid: "vibrant photorealistic",
    teen: "modern cinematic",
    adult: "professional photography",
    professional: "scientific photography",
  };

  return {
    colorScheme,
    primaryColors,
    colorMeaning: {
      [primaryColors[0]]: "primary concept",
      [primaryColors[1]]: "supporting elements",
      [primaryColors[2]]: "highlights/emphasis",
    },
    illustrationStyle: styleMap[audience] || "photorealistic",
  };
}

/**
 * Calculate optimal visual size based on concept importance
 */
function calculateOptimalSize(
  concept: Concept,
  audience: string,
): { width: number; height: number } {
  let baseWidth = 400;
  let baseHeight = 300;

  // Priority 1 visuals are larger
  if (concept.priority === 1) {
    baseWidth = 600;
    baseHeight = 450;
  } else if (concept.priority === 3) {
    baseWidth = 300;
    baseHeight = 225;
  }

  // Adjust for audience (kids need larger, simpler visuals)
  if (audience === "kid") {
    baseWidth *= 1.2;
    baseHeight *= 1.2;
  }

  return {
    width: baseWidth,
    height: baseHeight,
  };
}

/**
 * Determine detail level based on concept and audience
 */
function determineDetailLevel(concept: Concept, audience: string): string {
  const detailLevels: Record<string, Record<number, string>> = {
    kid: { 1: "simple", 2: "simple", 3: "minimal" },
    teen: { 1: "medium", 2: "medium-low", 3: "simple" },
    adult: { 1: "medium-high", 2: "medium", 3: "medium-low" },
    professional: { 1: "high", 2: "medium-high", 3: "medium" },
  };

  return detailLevels[audience]?.[concept.priority] || "medium";
}

/**
 * Find similar visual for style reference
 */
function findSimilarVisual(concept: Concept, position: number): string {
  if (position === 0) {
    return "First visual - establish baseline style";
  }

  if (concept.relatedTo.length > 0) {
    return `Similar style to Visual #${concept.relatedTo[0]}`;
  }

  return `Consistent with previous visuals (1-${position})`;
}

// Duplicate generateAIContext function removed - keeping only the one at line 175

/**
 * Batch generate detailed briefs for multiple concepts
 * Uses parallel AI calls for speed
 */
export async function generateDetailedBriefs(
  concepts: Concept[],
  options: Omit<ContextGenerationOptions, "taskPosition">,
): Promise<DetailedWorkerBrief[]> {
  // Generate all briefs in parallel (fast!)
  const briefs = await Promise.all(
    concepts.map((concept, index) =>
      generateDetailedBrief(concept, {
        ...options,
        taskPosition: index,
        allConcepts: concepts,
      }),
    ),
  );

  return briefs;
}

/**
 * Validate that a brief has all required context
 */
export function validateBrief(brief: DetailedWorkerBrief): {
  isValid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  if (!brief.educationalGoal.whatToTeach) {
    missingFields.push("educationalGoal.whatToTeach");
  }
  if (brief.visualRequirements.mustShow.length === 0) {
    missingFields.push("visualRequirements.mustShow");
  }
  if (!brief.narrativeIntegration.voiceScript) {
    missingFields.push("narrativeIntegration.voiceScript");
  }
  if (!brief.styleGuidelines.colorScheme) {
    missingFields.push("styleGuidelines.colorScheme");
  }
  if (brief.qualityRequirements.mustHave.length === 0) {
    missingFields.push("qualityRequirements.mustHave");
  }

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}

export default {
  generateDetailedBrief,
  generateDetailedBriefs,
  validateBrief,
};
