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
};

const PHASE_LABEL: Record<Exclude<JarvisPhase, "idle">, string> = {
  teaching: "Jarvis is teaching",
  listening: "Microphone is on — Jarvis is listening",
  watching: "Microphone is on — Jarvis is watching the canvas",
};

/** Live mic/Jarvis status dot. Sits in the footer row so it lines up with the
 * encrypted-icon and help button rather than floating over them.
 * Keyframes live in index.scss — injecting a <style> here would re-parse on
 * every phase change. */
const JarvisStatusDot = ({ phase }: { phase: JarvisPhase }) => {
  if (phase === "idle") {
    return null;
  }
  return (
    <div
      className="jarvis-status-dot"
      data-phase={phase}
      role="status"
      aria-label={PHASE_LABEL[phase]}
      title={PHASE_LABEL[phase]}
      style={{ backgroundColor: PHASE_COLOR[phase] }}
    />
  );
};

export const AppFooter = React.memo(
  ({
    onChange,
    jarvisPhase = "idle",
  }: {
    onChange: () => void;
    jarvisPhase?: JarvisPhase;
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
          <JarvisStatusDot phase={jarvisPhase} />
          {!isExcalidrawPlusSignedUser && <EncryptedIcon />}
        </div>
      </Footer>
    );
  },
);
