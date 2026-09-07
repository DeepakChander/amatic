import { Footer } from "@amatic/amatic/index";
import React from "react";

import { isExcalidrawPlusSignedUser } from "../app_constants";

import { DebugFooter, isVisualDebuggerEnabled } from "./DebugCanvas";
import { EncryptedIcon } from "./EncryptedIcon";

import type { JarvisPhase } from "../hooks/useCanvasJarvis";

const PHASE_COLOR: Record<Exclude<JarvisPhase, "idle">, string> = {
  teaching: "#3b82f6",
  listening: "#f97316",
  watching: "#22c55e",
  error: "#ef4444",
};

const PHASE_LABEL: Record<Exclude<JarvisPhase, "idle">, string> = {
  teaching: "Jarvis is teaching",
  listening: "Microphone is on — Jarvis is listening",
  watching: "Microphone is on — Jarvis is watching the canvas",
  error: "Jarvis could not respond",
};

/** Live mic/Jarvis status dot. Sits in the footer row so it lines up with the
 * encrypted-icon and help button rather than floating over them.
 * Keyframes live in index.scss — injecting a <style> here would re-parse on
 * every phase change.
 *
 * The red `error` phase makes the indicator honest: the same dot that says
 * "I'm listening" can also say "I'm broken" (docs/18 Phase 1.1). */
const JarvisStatusDot = ({
  phase,
  error,
}: {
  phase: JarvisPhase;
  error: string | null;
}) => {
  if (phase === "idle") {
    return null;
  }
  const label =
    phase === "error" && error
      ? `${PHASE_LABEL.error}: ${error}`
      : PHASE_LABEL[phase];
  return (
    <>
      <div
        className="jarvis-status-dot"
        data-phase={phase}
        role="status"
        aria-label={label}
        title={label}
        style={{ backgroundColor: PHASE_COLOR[phase] }}
      />
      {phase === "error" && (
        <span className="jarvis-status-error" title={label}>
          {error ?? PHASE_LABEL.error}
        </span>
      )}
    </>
  );
};

export const AppFooter = React.memo(
  ({
    onChange,
    jarvisPhase = "idle",
    jarvisError = null,
  }: {
    onChange: () => void;
    jarvisPhase?: JarvisPhase;
    jarvisError?: string | null;
  }) => {
    return (
      <Footer>
        <div
          style={{
            display: "flex",
            gap: ".5rem",
            alignItems: "center",
          }}
        >
          {isVisualDebuggerEnabled() && <DebugFooter onChange={onChange} />}
          <JarvisStatusDot phase={jarvisPhase} error={jarvisError} />
          {!isExcalidrawPlusSignedUser && <EncryptedIcon />}
        </div>
      </Footer>
    );
  },
);
