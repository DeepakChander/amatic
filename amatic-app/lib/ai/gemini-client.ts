/**
 * Google Gemini Image Generation Client
 *
 * Routes all image generation through the Express backend (/api/ai/worker).
 * Uses Gemini Nano Banana on the server; API keys stay server-side only.
 */

export interface ImageOptions {
  width?: number;
  height?: number;
  quality?: "standard" | "hd";
}

export interface ImageGenerationResult {
  url: string;
  base64?: string;
  quality: number;
  model: string;
  generationTime: number;
}

const getApiBase = (): string => {
  if (
    typeof window !== "undefined" &&
    (import.meta as any).env?.VITE_APP_AI_BACKEND
  ) {
    return (import.meta as any).env.VITE_APP_AI_BACKEND;
  }
  return "";
};

/**
 * Google AI Image Generation Client
 * Delegates to Express backend worker (Gemini Nano Banana)
 */
export class GoogleAIImageClient {
  constructor(_apiKey?: string) {
    // API key is server-side only; ignored on client
  }

  get isAvailable(): boolean {
    return true;
  }

  async generateImage(
    prompt: string,
    options: ImageOptions = {},
  ): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const base = getApiBase();
    const url = base ? `${base}/api/ai/worker` : "/api/ai/worker";

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: this.buildPrompt(prompt, options),
        style: "2d",
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || "Gemini worker failed");
    }

    const data = await response.json();

    return {
      url: data.imageUrl ?? "",
      base64: data.imageData,
      quality: 95,
      model: "gemini-nano-banana",
      generationTime: Date.now() - startTime,
    };
  }

  async generateStandard2D(
    prompt: string,
    options: ImageOptions = {},
  ): Promise<ImageGenerationResult> {
    return this.generateImage(prompt, options);
  }

  async generate3DStyle(
    prompt: string,
    options: ImageOptions = {},
  ): Promise<ImageGenerationResult> {
    return this.generateImage(prompt, options);
  }

  async generate3DFigurine(
    prompt: string,
    options: ImageOptions = {},
  ): Promise<ImageGenerationResult> {
    return this.generateImage(prompt, options);
  }

  private buildPrompt(basePrompt: string, options: ImageOptions): string {
    return `Generate a high-quality educational image.

${basePrompt}

Requirements:
- Clear, professional visualization
- Educational context
- High resolution (${options.width || 1024}x${options.height || 1024})
- No watermarks or text overlays
- Suitable for learning materials`;
  }
}

export function createGoogleAIClient(apiKey?: string): GoogleAIImageClient {
  return new GoogleAIImageClient(apiKey);
}

let globalClient: GoogleAIImageClient | null = null;

export function getGoogleAIClient(): GoogleAIImageClient {
  if (!globalClient) {
    globalClient = new GoogleAIImageClient();
  }
  return globalClient;
}

export default {
  GoogleAIImageClient,
  createGoogleAIClient,
  getGoogleAIClient,
};
