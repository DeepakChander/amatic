/**
 * Query Analyzer - Analyzes user queries for visual intent
 */

export interface QueryAnalysis {
  intent: "create" | "explain" | "modify" | "question";
  visualType?: "diagram" | "chart" | "illustration" | "text";
  confidence: number;
  keywords: string[];
  audience: "kid" | "teen" | "adult" | "professional";
  emotion: "neutral" | "curious" | "confused" | "excited" | "frustrated";
}

export function analyzeQueryLocally(query: string): QueryAnalysis {
  const lowerQuery = query.toLowerCase();

  let intent: QueryAnalysis["intent"] = "question";
  if (lowerQuery.match(/create|make|draw|build/)) {
    intent = "create";
  } else if (lowerQuery.match(/explain|what is|how does|tell me/)) {
    intent = "explain";
  } else if (lowerQuery.match(/change|modify|update|edit/)) {
    intent = "modify";
  }

  let visualType: QueryAnalysis["visualType"] = undefined;
  if (lowerQuery.match(/diagram|flowchart|flow chart/)) {
    visualType = "diagram";
  } else if (lowerQuery.match(/chart|graph|plot/)) {
    visualType = "chart";
  } else if (lowerQuery.match(/draw|illustrate|picture|image/)) {
    visualType = "illustration";
  }

  // Detect audience level from language complexity
  let audience: QueryAnalysis["audience"] = "adult";
  if (lowerQuery.match(/simple|easy|basic|eli5|kids?/)) {
    audience = "kid";
  } else if (lowerQuery.match(/advanced|professional|technical|detailed/)) {
    audience = "professional";
  }

  // Detect emotion
  let emotion: QueryAnalysis["emotion"] = "neutral";
  if (lowerQuery.includes("?")) {
    emotion = "curious";
  }
  if (lowerQuery.match(/help|confused|don't understand|what|why/)) {
    emotion = "confused";
  }
  if (lowerQuery.match(/wow|amazing|cool|awesome/)) {
    emotion = "excited";
  }

  return {
    intent,
    visualType,
    confidence: 0.7,
    keywords: query.split(" ").filter((w) => w.length > 3),
    audience,
    emotion,
  };
}
