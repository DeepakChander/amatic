/**
 * Visual Task Planner
 *
 * Breaks down complex queries into 5-500 visual tasks.
 * Creates visual dependency graphs and prioritizes generation order.
 */

import type { Concept, LayoutStrategy, LayoutPlan } from "@/types/master-plan";

/**
 * Break down query into concepts using AI
 */
export async function breakdownIntoConcepts(
  query: string,
  audience: string,
): Promise<Concept[]> {
  const { generateAnthropicResponse } = await import(
    "@/lib/ai/anthropic-service"
  );

  const systemPrompt = `Break down queries into teachable concepts. Return ONLY valid JSON array.`;

  const userMessage = `Break down this query into teachable concepts:
Query: "${query}"
Audience: ${audience}

Analyze the complexity and determine how many visual explanations are needed.
- Simple queries: 5-15 concepts
- Medium queries: 20-50 concepts
- Complex queries: 50-200 concepts
- Comprehensive queries: 200-500 concepts

For each concept, provide:
- name: Short concept name
- description: What it explains
- priority: 1 (core), 2 (supporting), or 3 (detail)
- importance: 0.0 to 1.0
- keywords: Related terms

Response format (JSON array):
[
  {
    "name": "concept name",
    "description": "what it explains",
    "priority": 1,
    "importance": 0.9,
    "keywords": ["key", "terms"],
    "relatedTo": []
  }
]`;

  try {
    const aiResponse = await generateAnthropicResponse(
      [{ role: "user", content: userMessage }],
      systemPrompt,
    );

    const response = aiResponse.content;
    const jsonMatch = response.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      const concepts: Concept[] = JSON.parse(jsonMatch[0]);

      // Auto-assign relatedTo based on proximity and keywords
      for (let i = 0; i < concepts.length; i++) {
        const related: number[] = [];

        // Connect to adjacent concepts
        if (i > 0) {
          related.push(i);
        }
        if (i < concepts.length - 1) {
          related.push(i + 2);
        }

        // Find concepts with shared keywords
        for (let j = 0; j < concepts.length; j++) {
          if (i !== j) {
            const sharedKeywords = concepts[i].keywords.filter((k) =>
              concepts[j].keywords.includes(k),
            );
            if (sharedKeywords.length >= 2) {
              related.push(j + 1);
            }
          }
        }

        concepts[i].relatedTo = [...new Set(related)].slice(0, 5);
      }

      return concepts;
    }
  } catch (error) {
    console.error("[VisualTaskPlanner] breakdownIntoConcepts failed:", error);
  }

  // Fallback: Create basic concept structure
  return createFallbackConcepts(query);
}

/**
 * Create fallback concepts when AI fails
 */
function createFallbackConcepts(query: string): Concept[] {
  // Extract key terms from query
  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const uniqueWords = [...new Set(words)].slice(0, 10);

  return uniqueWords.map((word, i) => ({
    name: word,
    description: `Explaining ${word}`,
    priority: i < 3 ? 1 : i < 7 ? 2 : 3,
    importance: 1.0 - i * 0.1,
    relatedTo: i > 0 ? [i] : [],
    keywords: [word],
  }));
}

/**
 * Prioritize concepts for generation order
 */
export function prioritizeConcepts(concepts: Concept[]): Concept[] {
  return [...concepts].sort((a, b) => {
    // Priority 1 first
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Then by importance
    return b.importance - a.importance;
  });
}

/**
 * Plan visual layout strategy
 */
export function planLayout(concepts: Concept[], query: string): LayoutPlan {
  const strategy = determineLayoutStrategy(query, concepts.length);
  const positions = generatePositions(concepts, strategy);

  return {
    strategy,
    positions,
    canvasSize: calculateCanvasSize(concepts.length),
    clusters: strategy === "mind-map" ? generateClusters(concepts) : undefined,
  };
}

/**
 * Determine optimal layout strategy
 */
function determineLayoutStrategy(
  query: string,
  conceptCount: number,
): LayoutStrategy {
  const queryLower = query.toLowerCase();

  // Timeline/history = narrative flow (left to right)
  if (
    queryLower.includes("history") ||
    queryLower.includes("timeline") ||
    queryLower.includes("evolution")
  ) {
    return "narrative";
  }

  // Process/cycle = radial (circular flow)
  if (
    queryLower.includes("cycle") ||
    queryLower.includes("process") ||
    queryLower.includes("circular")
  ) {
    return "radial";
  }

  // System/architecture = hierarchical (tree structure)
  if (
    queryLower.includes("system") ||
    queryLower.includes("architecture") ||
    queryLower.includes("structure")
  ) {
    return "hierarchical";
  }

  // Many concepts = mind map (clustered)
  if (conceptCount > 50) {
    return "mind-map";
  }

  // Default = grid (organized, predictable)
  return "grid";
}

/**
 * Generate positions based on layout strategy
 */
function generatePositions(
  concepts: Concept[],
  strategy: LayoutStrategy,
): Array<{ x: number; y: number }> {
  switch (strategy) {
    case "grid":
      return generateGridLayout(concepts.length);

    case "radial":
      return generateRadialLayout(concepts.length);

    case "hierarchical":
      return generateHierarchicalLayout(concepts);

    case "narrative":
      return generateNarrativeLayout(concepts.length);

    case "mind-map":
      return generateMindMapLayout(concepts);

    default:
      return generateGridLayout(concepts.length);
  }
}

/**
 * Grid layout: Organized rows and columns
 */
function generateGridLayout(count: number): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = 550;
  const startX = 300;
  const startY = 200;

  for (let i = 0; i < count; i++) {
    positions.push({
      x: startX + (i % cols) * spacing,
      y: startY + Math.floor(i / cols) * 450,
    });
  }

  return positions;
}

/**
 * Radial layout: Circular arrangement
 */
function generateRadialLayout(count: number): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const centerX = 2000;
  const centerY = 1500;
  const radius = 800;

  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    positions.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  }

  return positions;
}

/**
 * Hierarchical layout: Tree structure
 */
function generateHierarchicalLayout(
  concepts: Concept[],
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];

  // Group by priority
  const levels = [
    concepts.filter((c) => c.priority === 1),
    concepts.filter((c) => c.priority === 2),
    concepts.filter((c) => c.priority === 3),
  ];

  let currentY = 200;

  for (const level of levels) {
    const spacing = 4000 / (level.length + 1);
    const levelY = currentY;
    level.forEach((_, i) => {
      positions.push({
        x: 300 + spacing * (i + 1),
        y: levelY,
      });
    });
    currentY += 500;
  }

  return positions;
}

/**
 * Narrative layout: Left to right flow
 */
function generateNarrativeLayout(
  count: number,
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  // const rows = Math.ceil(count / 6); // Reserved for future grid layout

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 6);
    const col = i % 6;

    positions.push({
      x: 300 + col * 600,
      y: 200 + row * 450,
    });
  }

  return positions;
}

/**
 * Mind map layout: Clustered by relationship
 */
function generateMindMapLayout(
  concepts: Concept[],
): Array<{ x: number; y: number }> {
  // Simple force-directed layout approximation
  const positions: Array<{ x: number; y: number }> = [];
  const centerX = 2500;
  const centerY = 1500;

  for (let i = 0; i < concepts.length; i++) {
    const angle = (2 * Math.PI * i) / concepts.length + Math.random() * 0.3;
    const distance = 400 + Math.random() * 600 + concepts[i].priority * 200;

    positions.push({
      x: centerX + distance * Math.cos(angle),
      y: centerY + distance * Math.sin(angle),
    });
  }

  return positions;
}

/**
 * Calculate required canvas size
 */
function calculateCanvasSize(conceptCount: number): {
  width: number;
  height: number;
} {
  const cols = Math.ceil(Math.sqrt(conceptCount));
  const rows = Math.ceil(conceptCount / cols);

  return {
    width: Math.max(4000, cols * 600),
    height: Math.max(3000, rows * 500),
  };
}

/**
 * Generate concept clusters for mind map
 */
function generateClusters(
  concepts: Concept[],
): Array<{ name: string; visualIds: number[] }> {
  const clusters: Map<string, number[]> = new Map();

  concepts.forEach((concept, i) => {
    const primaryKeyword = concept.keywords[0] || "general";
    const existing = clusters.get(primaryKeyword) || [];
    clusters.set(primaryKeyword, [...existing, i + 1]);
  });

  return Array.from(clusters.entries()).map(([name, visualIds]) => ({
    name,
    visualIds,
  }));
}

export default {
  breakdownIntoConcepts,
  prioritizeConcepts,
  planLayout,
};
