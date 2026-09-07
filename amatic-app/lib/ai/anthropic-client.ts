/**
 * Anthropic Client for Visual Reasoning AI
 *
 * Direct Anthropic API client for:
 * - Claude Sonnet 4 reasoning and content generation
 * - SVG code generation from AI knowledge
 * - Animation timeline generation
 * - Query analysis (age/tone/emotion detection)
 * - React component generation
 */

import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicConfig {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StreamChunk {
  type: "reasoning" | "content" | "done";
  text: string;
  isThinking?: boolean;
}

export interface SVGGenerationResult {
  svg: string;
  elements: SVGElementData[];
  physicsProperties: PhysicsProperties;
}

export interface ReactComponentResult {
  code: string;
  concepts: string[];
}

export interface SVGElementData {
  id: string;
  type: "circle" | "rect" | "ellipse" | "path" | "text" | "line" | "g";
  label?: string;
}

export interface PhysicsProperties {
  world: {
    gravity: { x: number; y: number };
  };
  elements: ElementPhysics[];
}

export interface ElementPhysics {
  id: string;
  bodyType: "static" | "dynamic" | "kinematic";
  shape?: "circle" | "rectangle" | "polygon";
  emitter?: boolean;
  absorbs?: string[];
  animation?: {
    type: "orbit" | "rotate" | "flow" | "pulse" | "fadeIn" | "fadeOut";
    target?: string;
    speed?: number;
    duration?: number;
  };
}

export interface TimelineScene {
  time: number;
  svg_action: {
    element: string;
    action: string;
    position?: string;
    animation?: string;
  };
  voice: string;
}

export interface AnimationTimeline {
  title: string;
  duration: number;
  scenes: TimelineScene[];
}

export interface QueryAnalysis {
  audience: "kid" | "teen" | "adult" | "professional";
  emotion: "curious" | "confused" | "excited" | "neutral" | "serious";
  topic: string;
  visualStyle: "cartoon" | "modern" | "professional" | "minimal";
  voiceTone: "warm" | "casual" | "professional" | "enthusiastic";
}

// Model configuration
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_TEMPERATURE = 0.5;
const DEFAULT_MAX_TOKENS = 64000;

// Task-specific temperature settings
const TASK_TEMPERATURES = {
  characterScene: 0.5,
  technical: 0.4,
  icons: 0.6,
  svgGeneration: 0.3,
  reasoning: 0.5,
};

export type TaskType = keyof typeof TASK_TEMPERATURES;

/**
 * Anthropic API Client
 */
export class AnthropicClient {
  private client: Anthropic;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config?: Partial<AnthropicConfig>) {
    const apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY || "";

    if (!apiKey && typeof window === "undefined") {
      console.warn("[Anthropic] API key not configured");
    }

    this.client = new Anthropic({ apiKey });
    this.model = config?.model || DEFAULT_MODEL;
    this.temperature = config?.temperature || DEFAULT_TEMPERATURE;
    this.maxTokens = config?.maxTokens || DEFAULT_MAX_TOKENS;
  }

  /**
   * Generate text (non-streaming)
   */
  async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: systemPrompt || undefined,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const textContent = response.content.find(
        (block) => block.type === "text",
      );
      return textContent && "text" in textContent ? textContent.text : "";
    } catch (error) {
      console.error("[Anthropic] Generate text error:", error);
      throw error;
    }
  }

  /**
   * Stream content with reasoning support
   */
  async *streamReasoning(
    prompt: string,
    systemPrompt?: string,
  ): AsyncGenerator<StreamChunk> {
    try {
      const stream = await this.client.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: systemPrompt || undefined,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta") {
          if (chunk.delta.type === "text_delta") {
            yield {
              type: "content",
              text: chunk.delta.text,
              isThinking: false,
            };
          }
        }
      }

      yield { type: "done", text: "" };
    } catch (error) {
      console.error("[Anthropic] Stream error:", error);
      throw error;
    }
  }

  /**
   * Generate SVG code from AI knowledge
   */
  async generateSVG(
    query: string,
    style: "cartoon" | "modern" | "professional" | "minimal" = "cartoon",
    audience: "kid" | "teen" | "adult" | "professional" = "adult",
  ): Promise<SVGGenerationResult> {
    const keyConcepts = this.extractKeyConcepts(query);
    const conceptList = keyConcepts.join(", ");

    const systemPrompt = `You are an expert SVG illustration generator. You create EDUCATIONAL, TOPIC-SPECIFIC SVG illustrations that visually explain concepts.

CRITICAL: This illustration MUST directly explain "${query}". Do NOT create generic shapes or random decorative elements.

QUERY KEY CONCEPTS: ${conceptList}
Your SVG MUST visually represent these concepts. Element IDs must reference these topics.

EDUCATIONAL REQUIREMENTS:
1. Central Subject: Main visual showing the core concept
2. Supporting Elements: 6-12 elements that explain aspects/components of the topic
3. Visual Flow: Arrange elements to show relationships, process flow, or hierarchy
4. Meaningful IDs: Every element id must relate to the topic

SVG TECHNICAL RULES:
1. Output ONLY valid SVG code - no explanations, no markdown
2. Use viewBox="0 0 400 300" for consistent sizing
3. Add xmlns="http://www.w3.org/2000/svg"
4. 8-15 distinct elements (groups, shapes, paths)
5. Colors: ${this.getColorPalette(style)}
6. NO opaque background rectangles - transparent canvas
7. Include 2-3 text labels for key terms (font-size="12-14")

TARGET AUDIENCE: ${audience}
STYLE: ${style}`;

    const prompt = `Create an educational SVG illustration that explains: "${query}"

Your SVG must include visual representations of: ${conceptList}

Output ONLY the SVG code. Start with <svg and end with </svg>. No explanations.`;

    let fullContent = "";

    for await (const chunk of this.streamReasoning(prompt, systemPrompt)) {
      if (chunk.type === "content") {
        fullContent += chunk.text;
      }
    }

    // Extract SVG from response
    const svgMatch = fullContent.match(/<svg[\s\S]*<\/svg>/i);
    const svg = svgMatch ? svgMatch[0] : this.generateFallbackSVG(query);

    // Parse elements from SVG
    const elements = this.parseSVGElements(svg);

    // Generate physics properties
    const physicsProperties = this.generatePhysicsProperties(elements, query);

    return { svg, elements, physicsProperties };
  }

  /**
   * Generate React component code
   */
  async generateReactComponent(
    query: string,
    audience: "kid" | "teen" | "adult" | "professional" = "adult",
  ): Promise<{ code: string; concepts: string[] }> {
    const concepts = this.extractKeyConcepts(query);
    const conceptList = concepts.join(", ");
    const componentName = this.generateComponentName(query);

    const systemPrompt = `You are an expert React component generator for educational visualizations.

Generate a fully functional React component with Framer Motion that teaches "${query}".

QUERY KEY CONCEPTS: ${conceptList}

MANDATORY STRUCTURE:
1. Export default function component named ${componentName}
2. useState for step management (minimum 4 steps)
3. Steps array with { title, explanation } objects
4. Framer Motion animations for each step
5. Interactive controls (onClick to advance steps)

AUDIENCE: ${audience}

Output ONLY the React/TypeScript code. Start with imports, end with export default.`;

    const prompt = `Generate a React component that teaches: "${query}"

Must include educational steps about: ${conceptList}

Create 4-6 steps that progressively explain the concept.
Each step should have visual animations and clear explanations.

Output ONLY the code. No markdown, no explanations.`;

    let fullContent = "";

    for await (const chunk of this.streamReasoning(prompt, systemPrompt)) {
      if (chunk.type === "content") {
        fullContent += chunk.text;
      }
    }

    // Extract code
    let code = fullContent;
    const codeBlockMatch = fullContent.match(
      /```(?:tsx|typescript|jsx)?\n([\s\S]*?)\n```/,
    );
    if (codeBlockMatch) {
      code = codeBlockMatch[1];
    }

    // Clean up code
    code = code.trim();
    code = code.replace(/;import/g, ";\nimport");

    return { code, concepts };
  }

  /**
   * Generate animation timeline
   */
  async generateTimeline(
    query: string,
    _svg: string,
    elements: SVGElementData[],
  ): Promise<AnimationTimeline> {
    const elementList = elements
      .map((e) => `- ${e.id}: ${e.type}${e.label ? ` (${e.label})` : ""}`)
      .join("\n");

    const systemPrompt = `You are an animation timeline generator. Create educational animation scripts that synchronize visuals with voice narration.

Output ONLY valid JSON with this structure:
{
  "title": "string",
  "duration": number (in seconds),
  "scenes": [
    {
      "time": number (start time in seconds),
      "svg_action": {
        "element": "element_id",
        "action": "fadeIn|fadeOut|highlight|pulse|orbit|rotate|flow|show|hide",
        "animation": "optional animation details"
      },
      "voice": "What to say at this moment"
    }
  ]
}`;

    const prompt = `Create an animation timeline for explaining: "${query}"

Available SVG elements:
${elementList}

Create 4-6 scenes that explain the concept step by step. Each scene should:
1. Highlight or animate a relevant element
2. Have voice narration explaining what's happening
3. Build on the previous scene

Output ONLY the JSON, no other text.`;

    let fullContent = "";

    for await (const chunk of this.streamReasoning(prompt, systemPrompt)) {
      if (chunk.type === "content") {
        fullContent += chunk.text;
      }
    }

    // Extract JSON
    try {
      const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Fall through to default
    }

    return this.generateDefaultTimeline(query, elements);
  }

  /**
   * Analyze query to detect audience, emotion, and topic
   */
  async analyzeQuery(query: string): Promise<QueryAnalysis> {
    const systemPrompt = `You are a query analyzer. Analyze the user's question and determine:
1. audience: kid (simple words), teen (casual), adult (normal), professional (technical)
2. emotion: curious, confused, excited, neutral, serious
3. topic: main subject category
4. visualStyle: cartoon (kids), modern (teens), professional (adults), minimal (technical)
5. voiceTone: warm (kids), casual (teens), professional (adults), enthusiastic (excited)

Output ONLY valid JSON:
{"audience":"...","emotion":"...","topic":"...","visualStyle":"...","voiceTone":"..."}`;

    const prompt = `Analyze this query: "${query}"`;

    let fullContent = "";

    for await (const chunk of this.streamReasoning(prompt, systemPrompt)) {
      if (chunk.type === "content") {
        fullContent += chunk.text;
      }
    }

    try {
      const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Fall through to default
    }

    return {
      audience: "adult",
      emotion: "curious",
      topic: "general",
      visualStyle: "modern",
      voiceTone: "professional",
    };
  }

  // Helper methods
  private extractKeyConcepts(query: string): string[] {
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "how",
      "what",
      "why",
      "does",
      "do",
      "did",
      "will",
      "would",
      "could",
      "should",
      "can",
      "work",
      "works",
      "explain",
      "me",
      "please",
      "tell",
      "show",
      "about",
      "of",
      "to",
      "in",
      "for",
      "on",
    ]);

    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));

    const allConcepts = [...new Set(words)];
    return allConcepts.slice(0, 8);
  }

  private generateComponentName(query: string): string {
    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 3);

    const pascalCase = words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");

    return `${pascalCase}Explanation`;
  }

  private getColorPalette(style: string): string {
    const palettes = {
      cartoon: "#FF6B6B, #4ECDC4, #45B7D1, #96CEB4, #FFEAA7, #DDA0DD",
      modern: "#2D3436, #636E72, #00B894, #0984E3, #6C5CE7, #FD79A8",
      professional: "#1A1A2E, #16213E, #0F3460, #E94560, #533483, #3282B8",
      minimal: "#000000, #333333, #666666, #6366F1",
    };
    return palettes[style as keyof typeof palettes] || palettes.modern;
  }

  private parseSVGElements(svg: string): SVGElementData[] {
    const elements: SVGElementData[] = [];
    const elementTypes = [
      "circle",
      "rect",
      "ellipse",
      "path",
      "text",
      "line",
      "g",
    ];

    for (const type of elementTypes) {
      const regex = new RegExp(`<${type}[^>]*id=["']([^"']+)["'][^>]*>`, "gi");
      let match;

      while ((match = regex.exec(svg)) !== null) {
        const element: SVGElementData = {
          id: match[1],
          type: type as SVGElementData["type"],
        };

        if (type === "text") {
          const textContent = svg.match(
            new RegExp(
              `<text[^>]*id=["']${match[1]}["'][^>]*>([^<]*)</text>`,
              "i",
            ),
          );
          if (textContent) {
            element.label = textContent[1];
          }
        }

        elements.push(element);
      }
    }

    return elements;
  }

  private generatePhysicsProperties(
    elements: SVGElementData[],
    query: string,
  ): PhysicsProperties {
    const queryLower = query.toLowerCase();

    let gravity = { x: 0, y: 0.5 };
    if (
      queryLower.includes("space") ||
      queryLower.includes("orbit") ||
      queryLower.includes("planet")
    ) {
      gravity = { x: 0, y: 0 };
    }

    const elementPhysics: ElementPhysics[] = elements.map((element) => {
      const physics: ElementPhysics = {
        id: element.id,
        bodyType: "static",
        shape: element.type === "circle" ? "circle" : "rectangle",
      };

      const idLower = element.id.toLowerCase();

      if (idLower.includes("sun") || idLower.includes("light")) {
        physics.emitter = true;
        physics.animation = { type: "pulse", speed: 1 };
      } else if (idLower.includes("earth") || idLower.includes("planet")) {
        physics.bodyType = "kinematic";
        physics.animation = { type: "orbit", target: "sun", speed: 0.5 };
      }

      return physics;
    });

    return {
      world: { gravity },
      elements: elementPhysics,
    };
  }

  private generateFallbackSVG(query: string): string {
    return `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
  <rect id="background" width="400" height="300" fill="#f8f9fa"/>
  <circle id="main-element" cx="200" cy="120" r="60" fill="#6366F1"/>
  <text id="title" x="200" y="220" text-anchor="middle" font-size="16" fill="#333">${query.slice(
    0,
    30,
  )}</text>
</svg>`;
  }

  private generateDefaultTimeline(
    query: string,
    elements: SVGElementData[],
  ): AnimationTimeline {
    const scenes: TimelineScene[] = [
      {
        time: 0,
        svg_action: {
          element: elements[0]?.id || "main-element",
          action: "fadeIn",
        },
        voice: `Let me explain ${query}.`,
      },
      {
        time: 3,
        svg_action: {
          element: elements[1]?.id || "main-element",
          action: "highlight",
        },
        voice: "Here we can see the main concept.",
      },
      {
        time: 6,
        svg_action: { element: "all", action: "highlight" },
        voice: "And that is the complete explanation!",
      },
    ];

    return {
      title: `Explaining: ${query}`,
      duration: 9,
      scenes,
    };
  }
}

/**
 * Create Anthropic client with task-specific configuration
 */
export function createAnthropicClient(
  config?: Partial<AnthropicConfig>,
  taskType?: TaskType,
): AnthropicClient {
  const temperature =
    taskType && TASK_TEMPERATURES[taskType]
      ? TASK_TEMPERATURES[taskType]
      : config?.temperature || DEFAULT_TEMPERATURE;

  return new AnthropicClient({
    ...config,
    temperature,
  });
}

// Export for backward compatibility with OpenRouter client imports
export { createAnthropicClient as createOpenRouterClient };
