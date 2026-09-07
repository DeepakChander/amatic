/**
 * Model Selector - Selects the appropriate AI model for image generation
 */

export type ImageModel =
  | "gemini-2.5-flash-image"
  | "gemini-pro-vision"
  | "dalle-3"
  | "stable-diffusion";

export interface ModelSelection {
  model: ImageModel;
  modelName: string;
  reason: string;
  fallback?: ImageModel;
}

export function selectModelForTask(
  taskType: string,
  requirements?: {
    speed?: "fast" | "balanced" | "quality";
    style?: "2d" | "3d" | "photorealistic";
  },
): ModelSelection {
  const speed = requirements?.speed || "balanced";

  if (speed === "fast") {
    return {
      model: "gemini-2.5-flash-image",
      modelName: "gemini-2.5-flash-image",
      reason: "Fast generation requested",
      fallback: "gemini-pro-vision",
    };
  }

  return {
    model: "gemini-2.5-flash-image",
    modelName: "gemini-2.5-flash-image",
    reason: "Default model for image generation (Nano Banana)",
    fallback: "gemini-pro-vision",
  };
}

/**
 * Alias used by detailed-context-generator
 */
export function selectModel(
  visualType: string,
  concept: any,
  options?: any,
): ModelSelection {
  return selectModelForTask(visualType, options);
}
