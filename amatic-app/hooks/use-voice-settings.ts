import { useState, useEffect } from "react";

import { PREMIUM_VOICES } from "@/lib/voice/voice-types";

export interface VoiceSettings {
  voiceEnabled: boolean;
  autoPlayResponses: boolean;
  selectedVoiceId: string;
  voiceSpeed: number;
  voiceVolume: number;
  voiceStability: number;
  voiceSimilarity: number;
  voiceStyle: number;
  speechRecognitionEnabled: boolean;
  autoSubmitVoice: boolean;
  voiceLanguage: string;
  speechTimeout: number;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  voiceEnabled: true,
  autoPlayResponses: false,
  selectedVoiceId: PREMIUM_VOICES[0].voice_id,
  voiceSpeed: 1.0,
  voiceVolume: 80,
  voiceStability: 0.5,
  voiceSimilarity: 0.8,
  voiceStyle: 0.0,
  speechRecognitionEnabled: true,
  autoSubmitVoice: true,
  voiceLanguage: "en-US",
  speechTimeout: 5000,
};

export function useVoiceSettings() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("voice-settings");
      if (saved) {
        const parsedSettings = JSON.parse(saved);
        setSettings({ ...DEFAULT_SETTINGS, ...parsedSettings });
      }
    } catch (error) {
      console.error("Error loading voice settings:", error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Save settings to localStorage
  const saveSettings = (newSettings: Partial<VoiceSettings>) => {
    try {
      const updatedSettings = { ...settings, ...newSettings };
      setSettings(updatedSettings);
      localStorage.setItem("voice-settings", JSON.stringify(updatedSettings));

      // Dispatch custom event for other components to listen
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("voiceSettingsChanged", {
            detail: updatedSettings,
          }),
        );
      }
    } catch (error) {
      console.error("Error saving voice settings:", error);
    }
  };

  // Listen for external settings changes
  useEffect(() => {
    const handleSettingsChange = (event: CustomEvent) => {
      setSettings(event.detail);
    };

    if (typeof window !== "undefined") {
      window.addEventListener(
        "voiceSettingsChanged",
        handleSettingsChange as EventListener,
      );
      return () => {
        window.removeEventListener(
          "voiceSettingsChanged",
          handleSettingsChange as EventListener,
        );
      };
    }
    return undefined;
  }, []);

  return {
    settings,
    isLoaded,
    updateSettings: saveSettings,
    resetSettings: () => saveSettings(DEFAULT_SETTINGS),
  };
}
