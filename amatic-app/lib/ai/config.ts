// AI Service Configuration - Official Provider APIs
export const AI_CONFIG = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-sonnet-4-20250514",
    maxTokens: 64000,
    contextWindow: 200000,
    temperature: 0.5,
  },

  svgGeneration: {
    model: "claude-sonnet-4-20250514",
    temperature: 0.3,
    maxTokens: 4000,
  },

  voice: {
    provider: "elevenlabs",
    apiKey: process.env.ELEVENLABS_API_KEY,
    defaultVoice: "EXAVITQu4vr4xnSDxMaL", // Bella
    model: "eleven_multilingual_v2",
  },

  images: {
    provider: "gemini",
    apiKey: process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY,
    model: "gemini-2.5-flash-image", // Nano Banana image generation model
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-r1",
    maxTokens: 32000,
    temperature: 0.7,
  },

  defaultProvider: "anthropic" as const,
};

// Available AI models (official providers)
export const AI_MODELS = {
  "claude-sonnet-4": {
    name: "Claude Sonnet 4",
    provider: "anthropic",
    description: "Best coding model - fast, high quality SVG generation",
  },
  "gemini-2-flash": {
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    description: "Fast image generation for educational content",
  },
} as const;

export type ModelKey = keyof typeof AI_MODELS;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface VisualSuggestion {
  type: string;
  description: string;
  priority?: number;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: "anthropic" | "gemini" | "elevenlabs" | "openrouter";
  tokensUsed?: number;
  visualSuggestions?: VisualSuggestion[];
  reasoning?: string;
}
