/**
 * Prompt Builder - Constructs optimized prompts for image generation
 */

export interface PromptOptions {
  style?: "2d" | "3d" | "schematic" | "photorealistic" | "organic";
  quality?: "draft" | "standard" | "high" | "ultra";
  elements?: string[];
  constraints?: string[];
}

export function buildImagePrompt(
  basePrompt: string,
  options?: PromptOptions,
): string {
  const style = options?.style || "2d";
  const quality = options?.quality || "standard";

  let enhancedPrompt = basePrompt;

  const styleGuides: Record<string, string> = {
    "2d": "Flat 2D illustration style",
    "3d": "Photorealistic 3D render",
    schematic: "Clean schematic diagram style",
    photorealistic: "Photorealistic with high detail",
    organic: "Organic, hand-drawn style",
  };

  enhancedPrompt += `. Style: ${styleGuides[style]}.`;

  const qualityGuides: Record<string, string> = {
    draft: "Quick sketch quality",
    standard: "Standard professional quality",
    high: "High definition, professional quality",
    ultra: "Ultra-high definition, maximum detail and clarity",
  };

  enhancedPrompt += ` Quality: ${qualityGuides[quality]}.`;

  if (options?.elements && options.elements.length > 0) {
    enhancedPrompt += ` Include: ${options.elements.join(", ")}.`;
  }

  if (options?.constraints && options.constraints.length > 0) {
    enhancedPrompt += ` Constraints: ${options.constraints.join(", ")}.`;
  }

  enhancedPrompt += " Transparent background for educational clarity.";

  return enhancedPrompt;
}

/** Brief-like shape for worker prompts (subset of DetailedWorkerBrief) */
interface WorkerBriefLike {
  concept?: string;
  title?: string;
  description?: string;
  imagePrompt?: string;
  educationalGoal?: {
    whatToTeach?: string;
    keyInsight?: string;
    userUnderstanding?: string;
  };
  visualRequirements?: {
    mustShow?: string[];
    visualMetaphor?: string;
    emphasize?: string;
    detailLevel?: string;
  };
  styleGuidelines?: {
    colorScheme?: string;
    primaryColors?: string[];
    illustrationStyle?: string;
    background?: string;
  };
}

/**
 * Build prompt optimized for a specific worker using DetailedWorkerBrief fields
 */
export function buildPromptForWorker(
  concept: string | WorkerBriefLike,
  options?: PromptOptions,
): string {
  if (typeof concept === "string") {
    return buildImagePrompt(concept.trim(), options);
  }

  const brief = concept as WorkerBriefLike;
  const parts: string[] = [];

  const base =
    brief.imagePrompt ||
    brief.concept ||
    brief.title ||
    brief.description ||
    "";
  if (base) parts.push(base.trim());

  const goal = brief.educationalGoal;
  if (goal) {
    if (goal.whatToTeach) parts.push(`Teach: ${goal.whatToTeach}`);
    if (goal.keyInsight) parts.push(`Key insight: ${goal.keyInsight}`);
    if (goal.userUnderstanding)
      parts.push(`User should understand: ${goal.userUnderstanding}`);
  }

  const visual = brief.visualRequirements;
  if (visual) {
    if (visual.mustShow?.length)
      parts.push(`Must show: ${visual.mustShow.join(", ")}`);
    if (visual.visualMetaphor)
      parts.push(`Visual metaphor: ${visual.visualMetaphor}`);
    if (visual.emphasize) parts.push(`Emphasize: ${visual.emphasize}`);
    if (visual.detailLevel) parts.push(`Detail level: ${visual.detailLevel}`);
  }

  const style = brief.styleGuidelines;
  if (style) {
    if (style.illustrationStyle)
      parts.push(`Style: ${style.illustrationStyle}`);
    if (style.colorScheme) parts.push(`Colors: ${style.colorScheme}`);
    if (style.primaryColors?.length)
      parts.push(`Primary colors: ${style.primaryColors.join(", ")}`);
  }

  const basePrompt =
    parts.length > 0 ? parts.join(". ") : "Educational illustration";
  return buildImagePrompt(basePrompt, options);
}
