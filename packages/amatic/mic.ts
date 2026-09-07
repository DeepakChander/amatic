import { useEffect, useState } from "react";

/**
 * Mic on/off state, shared between the editor toolbar and the host app's
 * voice loop. Deliberately a module-level store rather than editor jotai:
 * the app's listener (useCanvasJarvis) lives outside the editor's provider
 * and so cannot read editor atoms.
 */

const STORAGE_KEY = "amatic-mic-enabled";
const DEFAULT_ENABLED = true;

const readPersisted = (): boolean => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === null ? DEFAULT_ENABLED : saved === "true";
  } catch {
    return DEFAULT_ENABLED;
  }
};

let enabled = typeof window === "undefined" ? DEFAULT_ENABLED : readPersisted();

const listeners = new Set<() => void>();

export const isMicEnabled = (): boolean => enabled;

export const setMicEnabled = (next: boolean): void => {
  if (enabled === next) {
    return;
  }
  enabled = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // persistence is best-effort; the toggle still works for this session
  }
  listeners.forEach((listener) => listener());
};

export const subscribeToMic = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useMicEnabled = (): boolean => {
  const [value, setValue] = useState(isMicEnabled);

  useEffect(() => {
    // resync on mount in case the store changed between render and effect
    setValue(isMicEnabled());
    return subscribeToMic(() => setValue(isMicEnabled()));
  }, []);

  return value;
};
