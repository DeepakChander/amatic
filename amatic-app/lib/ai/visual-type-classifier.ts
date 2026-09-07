/**
 * Visual Type Classifier - Classifies the type of visual to generate
 */

export type VisualType =
  | "2d-standard"
  | "3d-style-2d"
  | "true-3d"
  | "diagram"
  | "flowchart"
  | "mindmap"
  | "chart"
  | "icon"
  | "text";

export interface VisualClassification {
  type: VisualType;
  confidence: number;
  suggestedStyle?: "2d" | "3d" | "schematic" | "photorealistic";
}

export function classifyVisualType(
  description: string | any,
  context?: any,
): VisualClassification {
  const text =
    typeof description === "string"
      ? description
      : description?.title || description?.description || "";
  const lower = text.toLowerCase();

  let type: VisualType = "2d-standard";
  let suggestedStyle: VisualClassification["suggestedStyle"] = "2d";

  if (lower.match(/3d|three.?dimensional|model|figurine/)) {
    type = "true-3d";
    suggestedStyle = "3d";
  } else if (lower.match(/realistic|render|photorealistic/)) {
    type = "3d-style-2d";
    suggestedStyle = "photorealistic";
  } else if (lower.match(/diagram|flowchart|flow/)) {
    type = "diagram";
    suggestedStyle = "schematic";
  } else if (lower.match(/mindmap|mind map|concept map/)) {
    type = "mindmap";
    suggestedStyle = "schematic";
  } else if (lower.match(/chart|graph|bar|line|pie/)) {
    type = "chart";
    suggestedStyle = "2d";
  } else if (lower.match(/icon|symbol/)) {
    type = "icon";
    suggestedStyle = "2d";
  } else if (lower.match(/text|label|annotation/)) {
    type = "text";
  }

  return {
    type,
    confidence: 0.75,
    suggestedStyle,
  };
}
