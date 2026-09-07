/**
 * Voice Monitor - Continuous Voice Listening
 *
 * Uses Web Speech API (browser built-in, free)
 * Always listening for wake word and questions
 */

export type VoiceStatus = "inactive" | "listening" | "processing" | "speaking";

export interface VoiceTranscript {
  text: string;
  timestamp: number;
  isFinal: boolean;
  confidence: number;
}

interface VoiceMonitorOptions {
  wakeWord?: string;
  onTranscript?: (transcript: VoiceTranscript) => void;
  onWakeWord?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Voice Monitor using Web Speech API
 */
export class VoiceMonitor {
  private recognition: any = null;
  private status: VoiceStatus = "inactive";
  private options: VoiceMonitorOptions;
  private isActive = false;

  constructor(options: VoiceMonitorOptions = {}) {
    this.options = {
      wakeWord: "hey amatic",
      ...options,
    };
    this.initialize();
  }

  private initialize() {
    if (typeof window === "undefined") {
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";

    this.recognition.onstart = () => {
      this.status = "listening";
    };

    this.recognition.onend = () => {
      if (this.isActive) {
        try {
          this.recognition.start();
        } catch (e) {
          // ignore
        }
      } else {
        this.status = "inactive";
      }
    };

    this.recognition.onresult = (event: any) => {
      const results = Array.from(event.results);
      const lastResult = results[results.length - 1] as any;
      const transcript = lastResult[0]?.transcript ?? "";
      const isFinal = lastResult.isFinal;
      const confidence = lastResult[0]?.confidence ?? 0;

      const voiceTranscript: VoiceTranscript = {
        text: transcript.toLowerCase().trim(),
        timestamp: Date.now(),
        isFinal,
        confidence,
      };

      // Check for wake word
      if (this.options.wakeWord && voiceTranscript.text.includes(this.options.wakeWord)) {
        this.options.onWakeWord?.();
      }

      // Send transcript
      if (isFinal) {
        this.options.onTranscript?.(voiceTranscript);
      }
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        return; // Normal, ignore
      }
      // Permission errors are terminal: every restart re-fires the same error,
      // so auto-restarting on `onend` would spin a hot loop. Go inactive and
      // wait for an explicit start() (i.e. the user toggling the mic back on).
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        this.isActive = false;
        this.status = "inactive";
      }
      console.error("[VoiceMonitor] Error:", event.error);
      this.options.onError?.(new Error(event.error));
    };
  }

  /**
   * Start listening
   */
  start() {
    if (this.recognition && !this.isActive) {
      try {
        this.recognition.start();
        this.isActive = true;
      } catch (error) {
        // Already started
      }
    }
  }

  /**
   * Stop listening
   */
  stop() {
    if (this.recognition && this.isActive) {
      this.recognition.stop();
      this.isActive = false;
      this.status = "inactive";
    }
  }

  /**
   * Dynamically switch the recognition language.
   * Restarts recognition so the new language takes effect immediately.
   * Called when canvas-monitor detects the student is typing in a non-English language.
   */
  setLanguage(lang: string) {
    if (!this.recognition || this.recognition.lang === lang) return;
    this.recognition.lang = lang;
    if (this.isActive) {
      // Restart to apply new language — onend will auto-restart
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Get current recognition language
   */
  getLanguage(): string {
    return this.recognition?.lang ?? "en-US";
  }

  /**
   * Get current status
   */
  getStatus(): VoiceStatus {
    return this.status;
  }

  /**
   * Check if voice is supported
   */
  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    );
  }
}

/**
 * Create voice monitor instance
 */
export function createVoiceMonitor(
  options?: VoiceMonitorOptions,
): VoiceMonitor {
  return new VoiceMonitor(options);
}
