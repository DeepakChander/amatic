/**
 * Content Type Classifier
 *
 * Classifies user queries to determine optimal text ratio (8-45%)
 * and content presentation strategy.
 *
 * Uses pattern matching + AI analysis for accurate classification.
 */

import { ContentType, type ContentClassification } from "@/types/master-plan";

/**
 * Keyword patterns for content type detection
 */
const CONTENT_PATTERNS = {
  mathematical: [
    "equation",
    "formula",
    "proof",
    "theorem",
    "calculate",
    "solve",
    "integral",
    "derivative",
    "algebra",
    "geometry",
    "trigonometry",
    "calculus",
    "matrix",
    "vector",
    "function",
    "graph",
    "polynomial",
    "pythagorean",
    "quadratic",
    "linear",
    "exponential",
    "logarithm",
  ],

  scientificTheory: [
    "theory of",
    "relativity",
    "quantum",
    "evolution",
    "gravity",
    "thermodynamics",
    "atomic theory",
    "cell theory",
    "big bang",
    "plate tectonics",
    "natural selection",
    "electromagnetic",
    "molecular",
    "genetic",
    "conservation",
    "entropy",
  ],

  philosophical: [
    "philosophy",
    "ethics",
    "moral",
    "kant",
    "aristotle",
    "plato",
    "nietzsche",
    "existential",
    "categorical imperative",
    "utilitarianism",
    "virtue ethics",
    "deontology",
    "empiricism",
    "rationalism",
    "metaphysics",
    "epistemology",
    "phenomenology",
  ],

  technical: [
    "algorithm",
    "code",
    "programming",
    "function",
    "API",
    "database",
    "architecture",
    "design pattern",
    "data structure",
    "complexity",
    "recursion",
    "iteration",
    "class",
    "interface",
    "protocol",
    "framework",
    "library",
    "typescript",
    "react",
    "node",
  ],

  historical: [
    "revolution",
    "war",
    "empire",
    "ancient",
    "medieval",
    "renaissance",
    "century",
    "dynasty",
    "civilization",
    "colonial",
    "independence",
    "battle",
    "treaty",
    "king",
    "queen",
    "president",
    "timeline",
  ],

  simpleConcept: [
    "how does",
    "how do",
    "what is",
    "what are",
    "explain simply",
    "basic",
    "introduction",
    "for kids",
    "simple",
    "easy",
    "beginner",
    "work",
    "works",
    "operate",
    "function",
  ],
};

/**
 * Text ratio ranges for each content type
 */
const TEXT_RATIO_RANGES: Record<ContentType, { min: number; max: number }> = {
  [ContentType.SimpleConcept]: { min: 0.08, max: 0.15 },
  [ContentType.ScientificTheory]: { min: 0.25, max: 0.35 },
  [ContentType.Mathematical]: { min: 0.35, max: 0.45 },
  [ContentType.Philosophical]: { min: 0.3, max: 0.4 },
  [ContentType.Historical]: { min: 0.2, max: 0.3 },
  [ContentType.Technical]: { min: 0.4, max: 0.5 },
};

/**
 * Classify query using pattern matching (fast, local)
 */
export function classifyQueryLocally(query: string): ContentClassification {
  const queryLower = query.toLowerCase();

  // Count keyword matches for each type
  const scores: Record<ContentType, number> = {
    [ContentType.SimpleConcept]: 0,
    [ContentType.ScientificTheory]: 0,
    [ContentType.Mathematical]: 0,
    [ContentType.Philosophical]: 0,
    [ContentType.Historical]: 0,
    [ContentType.Technical]: 0,
  };

  // Score each content type based on keyword matches
  for (const [typeKey, keywords] of Object.entries(CONTENT_PATTERNS)) {
    const contentType =
      typeKey === "simpleConcept"
        ? ContentType.SimpleConcept
        : typeKey === "scientificTheory"
        ? ContentType.ScientificTheory
        : typeKey === "mathematical"
        ? ContentType.Mathematical
        : typeKey === "philosophical"
        ? ContentType.Philosophical
        : typeKey === "historical"
        ? ContentType.Historical
        : ContentType.Technical;

    for (const keyword of keywords) {
      if (queryLower.includes(keyword)) {
        scores[contentType]++;
      }
    }
  }

  // Find type with highest score
  let maxScore = 0;
  let detectedType = ContentType.SimpleConcept;

  for (const [type, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedType = type as ContentType;
    }
  }

  // Calculate text ratio based on detected type
  const range = TEXT_RATIO_RANGES[detectedType];
  const textRatio = (range.min + range.max) / 2;

  // Detect if equations or quotes are needed
  const requiresEquations =
    queryLower.includes("equation") ||
    queryLower.includes("formula") ||
    queryLower.includes("proof") ||
    detectedType === ContentType.Mathematical;

  const requiresQuotes =
    queryLower.includes("said") ||
    queryLower.includes("quote") ||
    detectedType === ContentType.Philosophical ||
    detectedType === ContentType.Historical;

  return {
    type: detectedType,
    textRatio,
    requiresEquations,
    requiresQuotes,
    confidence: maxScore > 0 ? 0.7 : 0.5,
  };
}

/**
 * Classify query using AI for higher accuracy
 */
export async function classifyQueryWithAI(
  query: string,
): Promise<ContentClassification> {
  try {
    const { generateAnthropicResponse } = await import(
      "@/lib/ai/anthropic-service"
    );

    const systemPrompt = `Analyze queries and classify them. Return ONLY valid JSON.`;

    const userMessage = `Analyze this query and classify it:
Query: "${query}"

Classify into ONE of these types:
1. simple-concept (8-15% text) - Basic how-to, practical explanations
2. scientific-theory (25-35% text) - Scientific theories with principles
3. mathematical (35-45% text) - Math concepts with equations/proofs
4. philosophical (30-40% text) - Philosophy with definitions/arguments
5. historical (20-30% text) - Historical events with dates/facts
6. technical (40-50% text) - Programming/tech with code examples

Consider:
- Does it need equations? (→ mathematical or technical)
- Does it need precise definitions? (→ theory or philosophical)
- Is it practical/hands-on? (→ simple-concept)
- Does it need quotes? (→ philosophical or historical)

Respond in JSON:
{
  "type": "TYPE_HERE",
  "textRatio": 0.XX,
  "requiresEquations": boolean,
  "requiresQuotes": boolean,
  "reasoning": "why you chose this type"
}`;

    const aiResponse = await generateAnthropicResponse(
      [{ role: "user", content: userMessage }],
      systemPrompt,
    );

    // Parse AI response
    const response = aiResponse.content;
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      return {
        type: parsed.type as ContentType,
        textRatio: parsed.textRatio,
        requiresEquations: parsed.requiresEquations,
        requiresQuotes: parsed.requiresQuotes,
        confidence: 0.9,
      };
    }
  } catch (error) {
    console.error(
      "[ContentClassifier] AI classification failed, using local:",
      error,
    );
  }

  // Fallback to local classification
  return classifyQueryLocally(query);
}

/**
 * Classify query (uses local first, optionally AI for accuracy)
 */
export async function classifyContent(
  query: string,
  useAI: boolean = false,
): Promise<ContentClassification> {
  if (useAI) {
    // Try AI classification first (more accurate)
    const aiResult = await classifyQueryWithAI(query);
    if (aiResult.confidence > 0.8) {
      return aiResult;
    }
  }

  // Use local pattern matching (faster)
  return classifyQueryLocally(query);
}

/**
 * Get text ratio for content type
 */
export function getTextRatioForType(type: ContentType): number {
  const range = TEXT_RATIO_RANGES[type];
  return (range.min + range.max) / 2;
}

/**
 * Adjust text ratio based on complexity
 */
export function adjustTextRatioForComplexity(
  baseRatio: number,
  complexity: number, // 0-1
): number {
  // More complex = more text needed
  const adjustment = (complexity - 0.5) * 0.1; // ±5%
  return Math.max(0.08, Math.min(0.5, baseRatio + adjustment));
}

/**
 * Get recommended text types for content type
 */
export function getRecommendedTextTypes(
  classification: ContentClassification,
): Array<"title" | "label" | "equation" | "definition" | "quote"> {
  const types: Array<"title" | "label" | "equation" | "definition" | "quote"> =
    ["title", "label"];

  if (classification.requiresEquations) {
    types.push("equation");
  }

  if (
    classification.type === ContentType.ScientificTheory ||
    classification.type === ContentType.Philosophical
  ) {
    types.push("definition");
  }

  if (classification.requiresQuotes) {
    types.push("quote");
  }

  return types;
}

/**
 * Explain classification decision
 */
export function explainClassification(
  classification: ContentClassification,
): string {
  const ratioPercent = Math.round(classification.textRatio * 100);
  const voicePercent = 100 - ratioPercent;

  const explanations: Record<ContentType, string> = {
    [ContentType.SimpleConcept]: `Simple concept - ${ratioPercent}% text (titles/labels only), ${voicePercent}% voice explanation`,
    [ContentType.ScientificTheory]: `Scientific theory - ${ratioPercent}% text (principles/definitions), ${voicePercent}% voice explanation`,
    [ContentType.Mathematical]: `Mathematical content - ${ratioPercent}% text (equations/proofs), ${voicePercent}% voice explanation`,
    [ContentType.Philosophical]: `Philosophical topic - ${ratioPercent}% text (quotes/definitions), ${voicePercent}% voice explanation`,
    [ContentType.Historical]: `Historical content - ${ratioPercent}% text (dates/facts), ${voicePercent}% voice explanation`,
    [ContentType.Technical]: `Technical/code content - ${ratioPercent}% text (code/syntax), ${voicePercent}% voice explanation`,
  };

  return explanations[classification.type];
}

export default {
  classifyContent,
  classifyQueryLocally,
  classifyQueryWithAI,
  getTextRatioForType,
  adjustTextRatioForComplexity,
  getRecommendedTextTypes,
  explainClassification,
};
