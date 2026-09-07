/**
 * ElevenLabs Voice Client
 *
 * Premium text-to-speech using ElevenLabs API
 * Supports 40+ high-quality voices with customization
 */

import { ElevenLabsClient as ElevenLabs } from "elevenlabs";

export interface TextToSpeechOptions {
  text: string;
  voice_id?: string;
  model_id?: string;
  voice_settings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
}

export interface VoiceGenerationResult {
  audio: Buffer;
  voice_id: string;
  model_id: string;
}

/**
 * ElevenLabs Client for Voice Synthesis
 */
export class ElevenLabsClient {
  private client: ElevenLabs;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || "";

    if (!this.apiKey && typeof window === "undefined") {
      console.warn("[ElevenLabs] No API key configured. Text-to-speech will fail.");
    }

    this.client = new ElevenLabs({ apiKey: this.apiKey });
  }

  /**
   * Convert text to speech
   */
  async textToSpeech(
    options: TextToSpeechOptions,
  ): Promise<VoiceGenerationResult> {
    try {
      const voice_id = options.voice_id || "EXAVITQu4vr4xnSDxMaL"; // Default: Bella
      const model_id = options.model_id || "eleven_multilingual_v2";

      const audio = await this.client.generate({
        voice: voice_id,
        model_id,
        text: options.text,
        voice_settings: options.voice_settings || {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      });

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of audio) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);

      return {
        audio: buffer,
        voice_id,
        model_id,
      };
    } catch (error) {
      console.error("[ElevenLabs] TTS generation failed:", error);
      throw new Error(
        `ElevenLabs TTS failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  /**
   * Stream text-to-speech (for real-time playback)
   */
  async *streamTextToSpeech(
    options: TextToSpeechOptions,
  ): AsyncGenerator<Uint8Array> {
    const voice_id = options.voice_id || "EXAVITQu4vr4xnSDxMaL";
    const model_id = options.model_id || "eleven_multilingual_v2";

    const audio = await this.client.generate({
      voice: voice_id,
      model_id,
      text: options.text,
      voice_settings: options.voice_settings || {
        stability: 0.5,
        similarity_boost: 0.75,
        use_speaker_boost: true,
      },
      stream: true,
    });

    for await (const chunk of audio) {
      yield chunk;
    }
  }

  /**
   * Get available voices
   */
  async getVoices() {
    try {
      const voices = await this.client.voices.getAll();
      return voices.voices;
    } catch (error) {
      console.error("[ElevenLabs] Failed to fetch voices:", error);
      return [];
    }
  }

  /**
   * Check if service is available
   */
  get isAvailable(): boolean {
    return !!this.apiKey;
  }
}

/**
 * Create ElevenLabs client instance
 */
export function createElevenLabsClient(apiKey?: string): ElevenLabsClient {
  return new ElevenLabsClient(apiKey);
}

/**
 * Singleton instance
 */
let globalClient: ElevenLabsClient | null = null;

export function getElevenLabsClient(): ElevenLabsClient {
  if (!globalClient) {
    globalClient = new ElevenLabsClient();
  }
  return globalClient;
}
