import { useState, useEffect, useRef, useCallback } from "react";

import { logger } from "@/lib/logger";

/**
 * Real-time Voice Conversation Hook
 * Using OpenAI Whisper for both input (transcription) and output (TTS)
 * Like ChatGPT Voice Mode - continuous listening with natural interruption
 */

export type VoiceStatus = "inactive" | "listening" | "speaking" | "processing";

interface UseRealtimeVoiceOptions {
  onTranscript?: (text: string) => void;
  onAIResponse?: (response: string) => void;
  onError?: (error: Error) => void;
  selectedModel?: string;
}

// Speech Recognition types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  generateVisuals?: (response: string, query: string) => void;
}

export function useRealtimeVoice(options: UseRealtimeVoiceOptions = {}) {
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("inactive");
  const [isActive, setIsActive] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState("");

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isProcessingRef = useRef(false); // Guard for race conditions

  // Store options in ref to avoid stale closures
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Store handleUserSpeech ref for use in recognition setup
  const handleUserSpeechRef = useRef<((transcript: string) => Promise<void>) | undefined>(undefined);

  // Initialize Speech Recognition (browser API for real-time transcription)
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const win = window as WindowWithSpeechRecognition;
    const SpeechRecognitionClass =
      win.SpeechRecognition || win.webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setVoiceStatus("listening");
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = Array.from(
          { length: event.results.length },
          (_, i) => event.results[i],
        )
          .map((result) => result[0].transcript)
          .join("");

        setCurrentTranscript(transcript);

        // If final result, process it
        if (event.results[event.results.length - 1].isFinal) {
          handleUserSpeechRef.current?.(transcript);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // Ignore no-speech and aborted errors - these are normal
        if (event.error === "no-speech" || event.error === "aborted") {
          return;
        }
        logger.error("Speech recognition error", event.error);
        optionsRef.current.onError?.(new Error(event.error));
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Stop AI speech (when user interrupts) - defined first as it has no dependencies
  const stopAISpeech = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
  }, []);

  // Start listening - defined early as it has no dependencies
  const startListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        // Already started, ignore
      }
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setVoiceStatus("inactive");
  }, []);

  // Speak AI response using OpenAI TTS (Whisper)
  const speakResponse = useCallback(
    async (text: string) => {
      setVoiceStatus("speaking");

      try {
        // Call OpenAI TTS API (Whisper-based)
        const apiUrl =
          typeof window !== "undefined"
            ? `${window.location.origin}/api/voice/whisper-tts`
            : "/api/voice/whisper-tts";

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: "nova", // Natural, clear voice for education
            speed: 1.0,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to synthesize speech: ${response.status}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;

        // Listen for user interruption
        audio.onended = () => {
          currentAudioRef.current = null;
          URL.revokeObjectURL(audioUrl); // Clean up
          if (isActive) {
            setVoiceStatus("listening");
          }
        };

        await audio.play();
      } catch (error) {
        logger.error("Error speaking response", error);
        optionsRef.current.onError?.(error as Error);
        setVoiceStatus("listening");
      }
    },
    [isActive],
  );

  // Handle user speech - send to AI (defined after its dependencies)
  const handleUserSpeech = useCallback(
    async (transcript: string) => {
      // Guard against race conditions - prevent multiple simultaneous processing
      if (!transcript.trim() || isProcessingRef.current) {
        return;
      }

      isProcessingRef.current = true;

      // Stop AI if it's speaking
      stopAISpeech();

      setVoiceStatus("processing");
      setCurrentTranscript(transcript);
      optionsRef.current.onTranscript?.(transcript);

      try {
        // Use simplified API approach - direct OpenAI call without user database check
        const apiUrl =
          typeof window !== "undefined"
            ? `${window.location.origin}/api/voice/chat-simple`
            : "/api/voice/chat-simple";

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: transcript,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            `Failed to get AI response: ${errorData.error || "Unknown error"}`,
          );
        }

        const data = await response.json();

        // Generate visuals in parallel
        const win = window as WindowWithSpeechRecognition;
        if (typeof window !== "undefined" && win.generateVisuals) {
          win.generateVisuals(data.response, transcript);
        }

        // Speak the response using OpenAI TTS (Whisper)
        await speakResponse(data.response);

        optionsRef.current.onAIResponse?.(data.response);

        // Back to listening
        if (isActive) {
          setVoiceStatus("listening");
          startListening();
        }
      } catch (error) {
        logger.error("Error processing speech", error);
        optionsRef.current.onError?.(error as Error);
        setVoiceStatus("listening");
      } finally {
        isProcessingRef.current = false;
      }
    },
    [isActive, stopAISpeech, speakResponse, startListening],
  );

  // Keep handleUserSpeechRef updated
  useEffect(() => {
    handleUserSpeechRef.current = handleUserSpeech;
  }, [handleUserSpeech]);

  // Toggle voice conversation
  const toggleVoiceConversation = useCallback(() => {
    if (isActive) {
      // Stop conversation
      stopListening();
      stopAISpeech();
      setIsActive(false);
      setVoiceStatus("inactive");
    } else {
      // Start conversation
      setIsActive(true);
      startListening();
    }
  }, [isActive, startListening, stopListening, stopAISpeech]);

  return {
    voiceStatus,
    isActive,
    currentTranscript,
    toggleVoiceConversation,
    stopAISpeech,
  };
}
