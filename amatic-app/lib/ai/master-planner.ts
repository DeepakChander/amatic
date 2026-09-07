/**
 * Master AI Planning System
 *
 * The brain of the multi-AI system. Uses chain-of-thought reasoning to:
 * - Analyze query complexity
 * - Determine optimal number of visuals (5-500)
 * - Decide text ratio (8-45%)
 * - Generate comprehensive voice script (90-95%)
 * - Create detailed briefs for all workers
 * - Plan highlight timeline and camera movements
 *
 * This is the intelligent orchestrator that coordinates 500+ workers.
 */

import { classifyContent } from "./content-type-classifier";
import {
  breakdownIntoConcepts,
  prioritizeConcepts,
  planLayout,
} from "./visual-task-planner";
import { generateDetailedBriefs } from "./detailed-context-generator";

import type {
  MasterPlan,
  TextElement,
  VoiceScript,
  HighlightTimeline,
  HighlightPoint,
  VoiceSegment,
  Concept,
} from "@/types/master-plan";

import { analyzeQueryLocally } from "@/lib/visual/query-analyzer";

export interface MasterPlannerOptions {
  useAIClassification?: boolean;
  maxVisuals?: number; // Limit for testing (default: 500)
  forceTextRatio?: number; // Override auto-detection
  onReasoning?: (reasoning: string) => void; // Stream reasoning to Dynamic Island
}

/**
 * Master AI Planner
 * Creates comprehensive plans with detailed worker briefs
 */
export class MasterAIPlanner {
  /**
   * Create complete master plan for a query
   * This is the main entry point for the entire system
   */
  async createMasterPlan(
    query: string,
    options: MasterPlannerOptions = {},
  ): Promise<MasterPlan> {
    const startTime = Date.now();

    // Helper to send reasoning to Dynamic Island
    const sendReasoning = (text: string) => {
      if (options.onReasoning) {
        options.onReasoning(text);
      }
    };

    // === STEP 1: CLASSIFY CONTENT TYPE ===
    sendReasoning(`Analyzing query type and complexity...`);
    sendReasoning(`Query: "${query}"`);

    const classification = await classifyContent(
      query,
      options.useAIClassification,
    );
    const textRatio = options.forceTextRatio ?? classification.textRatio;

    sendReasoning(`\nClassification: ${classification.type}`);
    sendReasoning(
      `Content will be ${Math.round(
        (1 - textRatio) * 100,
      )}% voice narration with photorealistic visuals`,
    );

    // === STEP 2: ANALYZE AUDIENCE & EMOTION ===
    sendReasoning(`\nDetecting audience level and tone...`);
    const queryAnalysis = analyzeQueryLocally(query);
    sendReasoning(`Target audience: ${queryAnalysis.audience}`);
    sendReasoning(`Emotional tone: ${queryAnalysis.emotion}`);

    // === STEP 3: BREAK DOWN INTO CONCEPTS ===
    sendReasoning(`\nBreaking down into teachable concepts...`);
    let concepts = await breakdownIntoConcepts(query, queryAnalysis.audience);

    // Limit if specified
    if (options.maxVisuals && concepts.length > options.maxVisuals) {
      sendReasoning(
        `Limiting to ${options.maxVisuals} visuals (identified ${concepts.length} total)`,
      );
      concepts = concepts.slice(0, options.maxVisuals);
    }

    sendReasoning(`Identified ${concepts.length} key concepts to visualize:`);
    concepts.slice(0, 5).forEach((c, i) => {
      sendReasoning(
        `  ${i + 1}. ${c.name} - ${c.description.substring(0, 60)}...`,
      );
    });
    if (concepts.length > 5) {
      sendReasoning(`  ... and ${concepts.length - 5} more concepts`);
    }

    // === STEP 4: PRIORITIZE CONCEPTS ===
    sendReasoning(`\nPrioritizing concepts for optimal learning flow...`);
    const prioritizedConcepts = prioritizeConcepts(concepts);
    const priority1Count = prioritizedConcepts.filter(
      (c) => c.priority === 1,
    ).length;
    sendReasoning(
      `Priority breakdown: ${priority1Count} core concepts, ${
        concepts.length - priority1Count
      } supporting details`,
    );

    // === STEP 5: PLAN LAYOUT ===
    sendReasoning(`\nPlanning visual layout and composition...`);
    const layout = planLayout(prioritizedConcepts, query);
    sendReasoning(
      `Layout strategy: ${layout.strategy} (optimized for ${queryAnalysis.audience} audience)`,
    );

    // === STEP 6: GENERATE VOICE SCRIPT ===
    sendReasoning(`\nGenerating comprehensive voice narration script...`);
    sendReasoning(
      `Voice will explain 100% of content (no text labels on images)`,
    );

    const voiceScript = await this.generateVoiceScript(
      prioritizedConcepts,
      query,
      queryAnalysis,
    );
    sendReasoning(
      `Voice script complete: ${Math.round(voiceScript.duration)} seconds, ${
        voiceScript.segments.length
      } segments`,
    );

    // === STEP 7: PLAN TEXT ELEMENTS ===
    // DISABLED: No text labels on visuals - voice narration explains everything
    sendReasoning(`\nSkipping text labels (clean photorealistic visuals only)`);
    const textElements: TextElement[] = []; // Empty - no text on images

    // === STEP 8: GENERATE DETAILED WORKER BRIEFS ===
    sendReasoning(
      `\nCreating detailed briefs for ${concepts.length} image generation workers...`,
    );
    sendReasoning(
      `Each brief includes: photorealistic prompts, educational goals, style guidelines`,
    );

    const workerBriefs = await generateDetailedBriefs(prioritizedConcepts, {
      query,
      audience: queryAnalysis.audience,
      totalConcepts: prioritizedConcepts.length,
      allConcepts: prioritizedConcepts,
      voiceScript,
      layout,
    });

    sendReasoning(`Generated ${workerBriefs.length} detailed worker briefs`);

    // Show model distribution to user
    const modelCounts: Record<string, number> = {};
    workerBriefs.forEach((b) => {
      const model = b.selectedModel || "nano-banana";
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    });
    sendReasoning(`\nModel distribution:`);
    Object.entries(modelCounts).forEach(([model, count]) => {
      sendReasoning(`  - ${model}: ${count} images`);
    });

    // === STEP 9: CREATE HIGHLIGHT TIMELINE ===
    sendReasoning(`\nSynchronizing voice narration with visual timeline...`);
    const timeline = this.createHighlightTimeline(voiceScript);
    sendReasoning(
      `Timeline created: ${timeline.points.length} synchronized highlight points`,
    );

    const planningTime = Date.now() - startTime;
    sendReasoning(`\n✓ Planning complete in ${planningTime}ms`);
    sendReasoning(
      `Ready to generate ${workerBriefs.length} photorealistic images!`,
    );

    // Return complete master plan
    return {
      query,
      contentType: classification.type,
      totalVisuals: workerBriefs.length,
      textRatio,
      workerBriefs,
      textElements,
      voiceScript,
      timeline,
      layout,
      estimatedDuration: voiceScript.duration,
      createdAt: Date.now(),
    };
  }

  /**
   * Generate comprehensive voice script (90-95% of explanation)
   */
  private async generateVoiceScript(
    concepts: Concept[],
    query: string,
    queryAnalysis: any,
  ): Promise<VoiceScript> {
    const { generateAnthropicResponse } = await import(
      "@/lib/ai/anthropic-service"
    );

    const conceptList = concepts
      .map((c, i) => `${i + 1}. ${c.name}`)
      .join("\n");

    const systemPrompt = `Create comprehensive voice narration scripts for teaching. Return the complete script.`;

    const userMessage = `Create a comprehensive voice narration script for teaching.

Query: "${query}"
Audience: ${queryAnalysis.audience}
Concepts to cover: ${concepts.length}

${conceptList}

CRITICAL: Images have NO TEXT LABELS.
Your voice narration must provide 100% of the educational content:

1. IDENTIFY what's visible in each image
   - Use phrases like "In this image, you can see..."
   - "Notice the..." "Look at the..." "On the left side..."
   
2. EXPLAIN every detail comprehensively
   - Provide full context for each concept
   - Explain how concepts connect
   - Give real-world examples
   - Use analogies for understanding
   
3. USE spatial language to guide attention
   - "On the left", "in the center", "at the top"
   - "The larger structure", "the small details"
   - "Moving from left to right"
   
4. BUILD from simple to complex
   - Start with overview
   - Add layers of detail
   - Connect to bigger picture

Duration target: ${
      concepts.length < 20 ? "2-3" : concepts.length < 50 ? "4-6" : "6-10"
    } minutes
(Longer narration since NO text to read - voice explains everything)

Structure:
1. Introduction (10%) - Hook and overview
2. Main Explanation (80%) - Detailed concept explanations with visual identification
3. Connections (5%) - How it all fits together
4. Conclusion (5%) - Summary and key takeaway

Use emotion markers: [WARM], [EXCITED], [CURIOUS], [SERIOUS], [AMAZED], [ENTHUSIASTIC], [CALM]

Example format:
[WARM] In the first image, you're looking at a photorealistic view of a human heart. On the right side, you can see the large chamber called the right atrium. Notice the network of blood vessels wrapping around the surface - these are the coronary arteries that supply oxygen to the heart muscle itself.

[EXCITED] Now look at this cross-section! See how the heart has four distinct chambers? The upper two are the atria, and the lower two are the ventricles. Notice how much thicker the left ventricle wall is - that's because it needs powerful muscles to pump blood throughout your entire body!

Generate the complete script now:`;

    try {
      const aiResponse = await generateAnthropicResponse(
        [{ role: "user", content: userMessage }],
        systemPrompt,
      );

      const response = aiResponse.content;

      // Parse script and extract segments
      const segments = this.parseScriptIntoSegments(response, concepts);
      const duration = this.estimateDuration(response);
      const emotionMarkers = this.extractEmotionMarkers(response);

      return {
        fullScript: response,
        duration,
        segments,
        emotionMarkers,
      };
    } catch (error) {
      console.error("[MasterPlanner] generateScript failed:", error);
      return this.generateFallbackScript(concepts, query);
    }
  }

  /**
   * Parse script into timed segments
   */
  private parseScriptIntoSegments(
    script: string,
    concepts: Concept[],
  ): VoiceSegment[] {
    // Split into sentences
    const sentences = script.match(/[^.!?]+[.!?]+/g) || [script];
    const wordsPerSecond = 2.5;

    const segments: VoiceSegment[] = [];
    let currentTime = 0;

    for (const sentence of sentences) {
      const wordCount = sentence.split(/\s+/).length;
      const duration = wordCount / wordsPerSecond;

      // Find which concepts this sentence mentions
      const mentionedConcepts: number[] = [];
      concepts.forEach((concept, i) => {
        if (sentence.toLowerCase().includes(concept.name.toLowerCase())) {
          mentionedConcepts.push(i + 1);
        }
      });

      // Extract emotion from markers or infer
      const emotion = this.inferEmotion(sentence);

      segments.push({
        text: sentence.trim(),
        startTime: currentTime,
        endTime: currentTime + duration,
        emotion,
        highlightVisuals: mentionedConcepts,
      });

      currentTime += duration;
    }

    return segments;
  }

  /**
   * Estimate total duration from script
   */
  private estimateDuration(script: string): number {
    const wordCount = script.split(/\s+/).length;
    return wordCount / 2.5; // ~2.5 words per second
  }

  /**
   * Extract emotion markers from script
   */
  private extractEmotionMarkers(
    script: string,
  ): import("@/types/master-plan").EmotionMarker[] {
    const markers: import("@/types/master-plan").EmotionMarker[] = [];
    const emotionPattern =
      /\[(WARM|EXCITED|CURIOUS|SERIOUS|AMAZED|PROFESSIONAL|CALM|ENTHUSIASTIC)\]/gi;

    let match;

    while ((match = emotionPattern.exec(script)) !== null) {
      const textBefore = script.substring(0, match.index);
      const wordsBefore = textBefore.split(/\s+/).length;
      const timestamp = wordsBefore / 2.5;

      const emotion = match[1].toLowerCase() as
        | "warm"
        | "excited"
        | "professional"
        | "curious"
        | "amazed"
        | "serious"
        | "calm"
        | "enthusiastic";

      markers.push({
        timestamp,
        emotion,
      });
    }

    return markers;
  }

  /**
   * Infer emotion from sentence content
   */
  private inferEmotion(sentence: string): string {
    const lower = sentence.toLowerCase();

    if (
      lower.includes("!") ||
      lower.includes("amazing") ||
      lower.includes("incredible")
    ) {
      return "excited";
    }
    if (lower.includes("?")) {
      return "curious";
    }
    if (lower.includes("important") || lower.includes("critical")) {
      return "serious";
    }
    if (lower.includes("notice") || lower.includes("look")) {
      return "curious";
    }

    return "professional";
  }

  /**
   * Generate fallback voice script
   */
  private generateFallbackScript(
    concepts: Concept[],
    query: string,
  ): VoiceScript {
    const intro = `Let me explain ${query} through multiple interconnected concepts.`;
    const body = concepts
      .map((c, i) => `Concept ${i + 1}: ${c.name}. ${c.description}`)
      .join(" ");
    const conclusion = `And that's how ${query} works. I hope this visual explanation helped!`;

    const fullScript = `${intro} ${body} ${conclusion}`;

    return {
      fullScript,
      duration: this.estimateDuration(fullScript),
      segments: this.parseScriptIntoSegments(fullScript, concepts),
      emotionMarkers: [],
    };
  }

  /**
   * Create highlight timeline for voice synchronization
   */
  private createHighlightTimeline(voiceScript: VoiceScript): HighlightTimeline {
    const points: HighlightPoint[] = [];

    // Create highlight point for each voice segment
    for (const segment of voiceScript.segments) {
      if (segment.highlightVisuals.length > 0) {
        points.push({
          timestamp: segment.startTime,
          elementIds: segment.highlightVisuals.map((id) => `visual-${id}`),
          action: "highlight",
          cameraPosition: segment.cameraPosition,
          duration: segment.endTime - segment.startTime,
        });
      }
    }

    return {
      points,
      duration: voiceScript.duration,
    };
  }
}

/**
 * Create master planner instance
 */
export function createMasterPlanner(): MasterAIPlanner {
  return new MasterAIPlanner();
}

/**
 * Quick helper: Create master plan for a query
 */
export async function createMasterPlanForQuery(
  query: string,
  options?: MasterPlannerOptions,
): Promise<MasterPlan> {
  const planner = createMasterPlanner();
  return planner.createMasterPlan(query, options);
}

export default {
  MasterAIPlanner,
  createMasterPlanner,
  createMasterPlanForQuery,
};
