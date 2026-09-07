import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/lib/utils";

export type StreamPhase = "idle" | "explaining" | "coding" | "error" | "complete";

// SVG Icon helper
const createIcon = (
  children: React.ReactNode,
  {
    width = 24,
    height = 24,
    ...props
  }: { width?: number; height?: number } & React.SVGProps<SVGSVGElement> = {},
) => (
  <svg
    aria-hidden="true"
    focusable="false"
    role="img"
    viewBox={`0 0 ${width} ${height}`}
    width={20}
    height={20}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {children}
  </svg>
);

// Hand-drawn style canvas icons
const LockIcon = createIcon(
  <g strokeWidth="1.25">
    <path d="M13.542 8.542H6.458a2.5 2.5 0 0 0-2.5 2.5v3.75a2.5 2.5 0 0 0 2.5 2.5h7.084a2.5 2.5 0 0 0 2.5-2.5v-3.75a2.5 2.5 0 0 0-2.5-2.5Z" />
    <path d="M10 13.958a1.042 1.042 0 1 0 0-2.083 1.042 1.042 0 0 0 0 2.083Z" />
    <path d="M6.667 8.333V5.417C6.667 3.806 8.159 2.5 10 2.5c1.841 0 3.333 1.306 3.333 2.917v2.916" />
  </g>,
  { width: 20, height: 20 },
);

const UnlockIcon = createIcon(
  <g>
    <path
      d="M13.542 8.542H6.458a2.5 2.5 0 0 0-2.5 2.5v3.75a2.5 2.5 0 0 0 2.5 2.5h7.084a2.5 2.5 0 0 0 2.5-2.5v-3.75a2.5 2.5 0 0 0-2.5-2.5Z"
      strokeWidth="1.25"
    />
    <path
      d="M10 13.958a1.042 1.042 0 1 0 0-2.083 1.042 1.042 0 0 0 0 2.083Z"
      strokeWidth="1.25"
    />
    <path
      d="M5.149 9.561v1.25h2.5v-1.25h-2.5Zm5.06-7.894V.417v1.25Zm2.559 3.508v1.25h2.5v-1.25h-2.5ZM7.648 8.51V5.175h-2.5V8.51h2.5Zm0-3.334c0-.564.243-1.128.713-1.561L6.668 1.775c-.959.883-1.52 2.104-1.52 3.4h2.5Zm.713-1.561a2.732 2.732 0 0 1 1.847-.697v-2.5c-1.31 0-2.585.478-3.54 1.358L8.36 3.614Zm1.847-.697c.71 0 1.374.26 1.847.697l1.694-1.839a5.231 5.231 0 0 0-3.54-1.358v2.5Zm1.847.697c.47.433.713.997.713 1.561h2.5c0-1.296-.56-2.517-1.52-3.4l-1.693 1.839Z"
      fill="currentColor"
      stroke="none"
    />
  </g>,
  { width: 20, height: 20 },
);

const HandIcon = createIcon(
  <g strokeWidth="1.25">
    <path d="M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5" />
    <path d="M11 5.5v-2a1.5 1.5 0 1 1 3 0v8.5" />
    <path d="M14 5.5a1.5 1.5 0 0 1 3 0v6.5" />
    <path d="M17 7.5a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47" />
  </g>,
);

const SelectionIcon = createIcon(
  <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M6 6l4.153 11.793a0.365 .365 0 0 0 .331 .207a0.366 .366 0 0 0 .332 -.207l2.184 -4.793l4.787 -1.994a0.355 .355 0 0 0 .213 -.323a0.355 .355 0 0 0 -.213 -.323l-11.787 -4.36z" />
    <path d="M13.5 13.5l4.5 4.5" />
  </g>,
  { width: 22, height: 22, strokeWidth: 1.25 },
);

const RectangleIcon = createIcon(
  <g strokeWidth="1.5">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </g>,
);

const DiamondIcon = createIcon(
  <g strokeWidth="1.5">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M10.5 20.4l-6.9 -6.9c-.781 -.781 -.781 -2.219 0 -3l6.9 -6.9c.781 -.781 2.219 -.781 3 0l6.9 6.9c.781 .781 .781 2.219 0 3l-6.9 6.9c-.781 .781 -2.219 .781 -3 0z" />
  </g>,
);

const EllipseIcon = createIcon(
  <g strokeWidth="1.5">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <circle cx="12" cy="12" r="9" />
  </g>,
);

const ArrowIcon = createIcon(
  <g strokeWidth="1.5">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <line x1="5" y1="12" x2="19" y2="12" />
    <line x1="15" y1="16" x2="19" y2="12" />
    <line x1="15" y1="8" x2="19" y2="12" />
  </g>,
);

const LineIcon = createIcon(<path d="M4.167 10h11.666" strokeWidth="1.5" />, {
  width: 20,
  height: 20,
});

const FreedrawIcon = createIcon(
  <g strokeWidth="1.25">
    <path
      clipRule="evenodd"
      d="m7.643 15.69 7.774-7.773a2.357 2.357 0 1 0-3.334-3.334L4.31 12.357a3.333 3.333 0 0 0-.977 2.357v1.953h1.953c.884 0 1.732-.352 2.357-.977Z"
    />
    <path d="m11.25 5.417 3.333 3.333" />
  </g>,
  { width: 20, height: 20 },
);

const TextIcon = createIcon(
  <g strokeWidth="1.5">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <line x1="4" y1="20" x2="7" y2="20" />
    <line x1="14" y1="20" x2="21" y2="20" />
    <line x1="6.9" y1="15" x2="13.8" y2="15" />
    <line x1="10.2" y1="6.3" x2="16" y2="20" />
    <polyline points="5 20 11 4 13 4 20 20" />
  </g>,
);

const ImageIcon = createIcon(
  <g strokeWidth="1.25">
    <path d="M12.5 6.667h.01" />
    <path d="M4.91 2.625h10.18a2.284 2.284 0 0 1 2.285 2.284v10.182a2.284 2.284 0 0 1-2.284 2.284H4.909a2.284 2.284 0 0 1-2.284-2.284V4.909a2.284 2.284 0 0 1 2.284-2.284Z" />
    <path d="m3.333 12.5 3.334-3.333c.773-.745 1.726-.745 2.5 0l4.166 4.166" />
    <path d="m11.667 11.667.833-.834c.774-.744 1.726-.744 2.5 0l1.667 1.667" />
  </g>,
  { width: 20, height: 20 },
);

const EraserIcon = createIcon(
  <g strokeWidth="1.5">
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3" />
    <path d="M18 13.3l-6.3 -6.3" />
  </g>,
);

// Pencil icon for collapsed Dynamic Island state
const PencilIslandIcon = (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

export type ToolType =
  | "selection"
  | "hand"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "freedraw"
  | "text"
  | "image"
  | "eraser";

interface Tool {
  type: ToolType;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
}

const TOOLS: Tool[] = [
  {
    type: "selection",
    icon: SelectionIcon,
    label: "Selection",
    shortcut: "V or 1",
  },
  {
    type: "rectangle",
    icon: RectangleIcon,
    label: "Rectangle",
    shortcut: "R or 2",
  },
  { type: "diamond", icon: DiamondIcon, label: "Diamond", shortcut: "D or 3" },
  { type: "ellipse", icon: EllipseIcon, label: "Ellipse", shortcut: "O or 4" },
  { type: "arrow", icon: ArrowIcon, label: "Arrow", shortcut: "A or 5" },
  { type: "line", icon: LineIcon, label: "Line", shortcut: "L or 6" },
  { type: "freedraw", icon: FreedrawIcon, label: "Draw", shortcut: "P or 7" },
  { type: "text", icon: TextIcon, label: "Text", shortcut: "T or 8" },
  { type: "image", icon: ImageIcon, label: "Image", shortcut: "9" },
  { type: "eraser", icon: EraserIcon, label: "Eraser", shortcut: "E or 0" },
];

// Color palette for drawing tools
const COLORS = [
  { name: "Black", value: "#1e1e1e" },
  { name: "White", value: "#ffffff" },
  { name: "Red", value: "#e03131" },
  { name: "Orange", value: "#fd7e14" },
  { name: "Yellow", value: "#fab005" },
  { name: "Green", value: "#40c057" },
  { name: "Blue", value: "#228be6" },
  { name: "Violet", value: "#7950f2" },
];

/**
 * Simple SVG syntax highlighting
 * Highlights tags, attributes, and values with different colors
 */
function highlightSVGCode(code: string): React.ReactNode[] {
  if (!code) {
    return [];
  }

  const result: React.ReactNode[] = [];
  let key = 0;

  // Split by lines and colorize each line
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineElements: React.ReactNode[] = [];
    let lastIndex = 0;

    // Find all matches and their positions
    const matches: {
      start: number;
      end: number;
      text: string;
      color: string;
    }[] = [];

    // Tags
    const tagRegex = /<\/?[\w-]+/g;
    let match;
    while ((match = tagRegex.exec(line)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        color: "#c792ea",
      });
    }

    // Attribute names
    const attrRegex = /[\w-]+(?==)/g;
    while ((match = attrRegex.exec(line)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        color: "#82aaff",
      });
    }

    // String values
    const valueRegex = /"[^"]*"/g;
    while ((match = valueRegex.exec(line)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        color: "#c3e88d",
      });
    }

    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);

    // Remove overlapping matches
    const filteredMatches: typeof matches = [];
    for (const m of matches) {
      if (
        filteredMatches.length === 0 ||
        m.start >= filteredMatches[filteredMatches.length - 1].end
      ) {
        filteredMatches.push(m);
      }
    }

    // Build line with highlighted parts
    for (const m of filteredMatches) {
      if (m.start > lastIndex) {
        lineElements.push(
          <span key={key++} className="text-white/60">
            {line.slice(lastIndex, m.start)}
          </span>,
        );
      }
      lineElements.push(
        <span key={key++} style={{ color: m.color }}>
          {m.text}
        </span>,
      );
      lastIndex = m.end;
    }

    if (lastIndex < line.length) {
      lineElements.push(
        <span key={key++} className="text-white/60">
          {line.slice(lastIndex)}
        </span>,
      );
    }

    result.push(
      <div key={`line-${i}`} className="whitespace-pre">
        {lineElements.length > 0 ? (
          lineElements
        ) : (
          <span className="text-white/60">{line || " "}</span>
        )}
      </div>,
    );
  }

  return result;
}

interface AmaticToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  isLocked?: boolean;
  onLockChange?: (locked: boolean) => void;
  activeColor?: string;
  onColorChange?: (color: string) => void;
  // AI streaming props (ChatGPT-style)
  aiPhase?: StreamPhase;
  aiExplanation?: string;
  aiCode?: string;
  aiError?: string | null;
  onCancelAI?: () => void;
}

export function AmaticToolbar({
  activeTool,
  onToolChange,
  isLocked = false,
  onLockChange,
  activeColor = "#1e1e1e",
  onColorChange,
  // AI props
  aiPhase = "idle",
  aiExplanation = "",
  aiCode = "",
  aiError = null,
  onCancelAI,
}: AmaticToolbarProps) {
  const [isPanning, setIsPanning] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedColor, setSelectedColor] = useState(activeColor);
  const [displayedExplanation, setDisplayedExplanation] = useState("");
  const [displayedCode, setDisplayedCode] = useState("");
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Determine if we're in AI mode
  const isAIActive = aiPhase !== "idle";
  const isStreaming = aiPhase === "explaining" || aiPhase === "coding";

  // Animate explanation text (typing effect)
  useEffect(() => {
    if (aiExplanation && aiExplanation.length > displayedExplanation.length) {
      const timeout = setTimeout(() => {
        // Add characters gradually for typing effect
        const charsToAdd = Math.min(
          5,
          aiExplanation.length - displayedExplanation.length,
        );
        setDisplayedExplanation(
          aiExplanation.slice(0, displayedExplanation.length + charsToAdd),
        );
      }, 15);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [aiExplanation, displayedExplanation]);

  // Animate code text (typing effect)
  useEffect(() => {
    if (aiCode && aiCode.length > displayedCode.length) {
      const timeout = setTimeout(() => {
        // Add characters gradually for typing effect
        const charsToAdd = Math.min(8, aiCode.length - displayedCode.length);
        setDisplayedCode(aiCode.slice(0, displayedCode.length + charsToAdd));
      }, 10);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [aiCode, displayedCode]);

  // Reset displayed content when new AI session starts
  useEffect(() => {
    if (aiPhase === "explaining") {
      setDisplayedExplanation("");
      setDisplayedCode("");
    }
  }, [aiPhase]);

  // Auto-scroll inside Dynamic Island (hidden scrollbar, user can't scroll manually)
  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayedExplanation, displayedCode, isStreaming]);

  // Auto-collapse after completion
  const currentPhase = aiPhase;
  useEffect(() => {
    if (currentPhase === "complete") {
      const timeout = setTimeout(() => {
        setIsExpanded(false);
        // Reset displayed content after collapse
        setTimeout(() => {
          setDisplayedExplanation("");
          setDisplayedCode("");
        }, 300);
      }, 2000);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [currentPhase]);

  // Auto-expand when AI starts
  useEffect(() => {
    if (isAIActive) {
      setIsExpanded(true);
    }
  }, [isAIActive]);

  // Handle color selection
  const handleColorSelect = (color: string) => {
    setSelectedColor(color);
    onColorChange?.(color);
  };

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
      }
    };
  }, []);

  // Handle click outside to collapse (only in tools mode)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        if (!isAIActive) {
          setIsExpanded(false);
        }
      }
    };

    if (isExpanded && !isAIActive) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isExpanded, isAIActive]);

  // Expand on hover (only in tools mode)
  const handleMouseEnter = () => {
    if (isAIActive) {
      return;
    }
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
    setIsExpanded(true);
  };

  // Collapse with delay on mouse leave (only in tools mode)
  const handleMouseLeave = () => {
    if (isAIActive) {
      return;
    }
    collapseTimeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
    }, 300);
  };

  // Handle tool selection with auto-collapse
  const handleToolSelect = (tool: ToolType) => {
    onToolChange(tool);
    setTimeout(() => {
      setIsExpanded(false);
    }, 400);
  };

  // Handle lock toggle with auto-collapse
  const handleLockToggle = () => {
    onLockChange?.(!isLocked);
    setTimeout(() => {
      setIsExpanded(false);
    }, 400);
  };

  // Handle pan toggle with auto-collapse
  const handlePanToggle = () => {
    setIsPanning(!isPanning);
    setTimeout(() => {
      setIsExpanded(false);
    }, 400);
  };

  // Highlighted code - memoized for performance
  const highlightedCode = useMemo(
    () => highlightSVGCode(displayedCode),
    [displayedCode],
  );

  // Animation variants
  const islandVariants = {
    collapsed: {
      width: 52,
      height: 40,
      borderRadius: 20,
      transition: {
        type: "spring" as const,
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      },
    },
    expandedTools: {
      width: "auto",
      height: "auto",
      borderRadius: 12,
      transition: {
        type: "spring" as const,
        stiffness: 300,
        damping: 25,
        mass: 0.8,
      },
    },
    expandedAI: {
      width: "100%", // Parent wrapper has w-[85%] max-w-xl to match chatbox exactly
      height: "auto",
      borderRadius: 16,
      transition: {
        type: "spring" as const,
        stiffness: 300,
        damping: 25,
        mass: 0.8,
      },
    },
  };

  const getIslandState = () => {
    if (!isExpanded && !isAIActive) {
      return "collapsed";
    }
    if (isAIActive) {
      return "expandedAI";
    }
    return "expandedTools";
  };

  return (
    <div
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none",
        isAIActive ? "top-3 w-[85%] max-w-xl" : "top-3",
      )}
      ref={containerRef}
      style={{ pointerEvents: "none" }}
    >
      <motion.div
        className={cn(
          "flex flex-col items-center justify-center overflow-hidden cursor-pointer",
          isAIActive && "w-full",
        )}
        style={{
          background:
            aiPhase === "error"
              ? "linear-gradient(135deg, #2e1a1a 0%, #3e1620 50%, #230f0f 100%)"
              : "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)",
          boxShadow:
            aiPhase === "error"
              ? "0 0 0 1px rgba(239, 68, 68, 0.3), 0 4px 20px rgba(239, 68, 68, 0.2), 0 0 40px rgba(239, 68, 68, 0.1)"
              : isExpanded
                ? "0 0 0 1px rgba(139, 92, 246, 0.2), 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 40px rgba(139, 92, 246, 0.1)"
                : "0 0 0 1px rgba(139, 92, 246, 0.3), 0 4px 16px rgba(0, 0, 0, 0.3), 0 0 30px rgba(139, 92, 246, 0.15)",
          pointerEvents: "auto",
        }}
        variants={islandVariants}
        initial="collapsed"
        animate={getIslandState()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => !isExpanded && !isAIActive && setIsExpanded(true)}
      >
        <AnimatePresence mode="wait">
          {/* COLLAPSED STATE */}
          {!isExpanded && !isAIActive && (
            <motion.div
              key="collapsed"
              className="flex items-center justify-center text-white/90"
              initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)",
                }}
                animate={{
                  opacity: [0.5, 0.8, 0.5],
                  scale: [1, 1.1, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              <div className="relative z-10 drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]">
                {PencilIslandIcon}
              </div>
            </motion.div>
          )}

          {/* AI STREAMING STATE - ChatGPT Style (including voice explanations) */}
          {isAIActive && (
            <motion.div
              key="ai-streaming"
              className="flex flex-col w-full px-4 py-3"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* Content area - auto-scrolls but no visible scrollbar, user can't manually scroll */}
              <div
                ref={contentRef}
                className="max-h-12 overflow-y-scroll scrollbar-none"
                style={{
                  scrollbarWidth: "none", // Firefox
                  msOverflowStyle: "none", // IE/Edge
                  WebkitOverflowScrolling: "touch",
                }}
                onWheel={(e) => e.preventDefault()} // Prevent manual scroll
              >
                {/* Explanation text */}
                {(displayedExplanation || aiPhase === "explaining") && (
                  <div className="text-[13px] text-white/70 leading-relaxed">
                    {displayedExplanation}
                    {/* Blinking cursor during explanation phase */}
                    {aiPhase === "explaining" && (
                      <motion.span
                        className="inline-block w-0.5 h-3.5 bg-white/60 ml-0.5 align-middle"
                        animate={{ opacity: [1, 0, 1] }}
                        transition={{ duration: 0.8, repeat: Infinity }}
                      />
                    )}
                  </div>
                )}

                {/* Divider between explanation and code */}
                {displayedExplanation &&
                  (aiPhase === "coding" || displayedCode) && (
                    <div className="flex items-center gap-2 my-2">
                      <div className="flex-1 h-px bg-white/10" />
                      <span className="text-[9px] text-white/25 uppercase tracking-wider">
                        svg
                      </span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>
                  )}

                {/* Code display with syntax highlighting - show when coding phase starts */}
                {(aiPhase === "coding" || displayedCode) && (
                  <div className="font-mono text-[11px] leading-relaxed bg-black/30 rounded-md p-2">
                    {highlightedCode}
                    {/* Blinking cursor during coding phase */}
                    {aiPhase === "coding" && (
                      <motion.span
                        className="inline-block w-0.5 h-3 bg-violet-400/80 ml-0.5 align-middle"
                        animate={{ opacity: [1, 0, 1] }}
                        transition={{ duration: 0.8, repeat: Infinity }}
                      />
                    )}
                  </div>
                )}

                {/* Error state */}
                {aiPhase === "error" && aiError && (
                  <div className="p-2 bg-red-500/10 rounded-md border border-red-500/20">
                    <p className="text-xs text-red-400">{aiError}</p>
                  </div>
                )}

                {/* Complete state - brief success indicator */}
                {aiPhase === "complete" && (
                  <motion.div
                    className="flex items-center justify-center gap-2 py-1"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <span className="text-[11px] text-green-400/80">
                      Added to canvas
                    </span>
                  </motion.div>
                )}
              </div>

              {/* Cancel button - inline with content */}
              {isStreaming && onCancelAI && (
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelAI();
                    }}
                    className="text-white/30 hover:text-white/60 text-[10px] px-2 py-0.5 rounded hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* EXPANDED TOOLS STATE */}
          {isExpanded && !isAIActive && (
            <motion.div
              key="expanded-tools"
              className="flex items-center gap-1 p-1"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: 1,
                scale: 1,
                transition: { staggerChildren: 0.02, delayChildren: 0.05 },
              }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
            >
              {/* Lock Button */}
              <motion.button
                initial={{ opacity: 0, scale: 0.5, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleLockToggle();
                }}
                className={cn(
                  "w-9 h-9 flex items-center justify-center rounded-lg transition-colors",
                  "hover:bg-white/10 text-white/80",
                  isLocked && "bg-violet-500/30 text-violet-300",
                )}
                title={isLocked ? "Unlock (Q)" : "Lock selection (Q)"}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {isLocked ? LockIcon : UnlockIcon}
              </motion.button>

              {/* Hand/Pan Tool */}
              <motion.button
                initial={{ opacity: 0, scale: 0.5, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePanToggle();
                }}
                className={cn(
                  "w-9 h-9 flex items-center justify-center rounded-lg transition-colors",
                  "hover:bg-white/10 text-white/80",
                  isPanning && "bg-violet-500/30 text-violet-300",
                )}
                title="Pan (H or Space+drag)"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {HandIcon}
              </motion.button>

              {/* Divider */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-px h-6 bg-white/20 mx-1"
              />

              {/* Main Tools */}
              {TOOLS.map((tool, index) => (
                <motion.button
                  key={tool.type}
                  initial={{ opacity: 0, scale: 0.5, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleToolSelect(tool.type);
                  }}
                  className={cn(
                    "w-9 h-9 flex items-center justify-center rounded-lg transition-colors relative",
                    "hover:bg-white/10 text-white/80",
                    activeTool === tool.type &&
                    "bg-violet-500/30 text-violet-300",
                  )}
                  style={{ pointerEvents: "auto" }}
                  title={`${tool.label} — ${tool.shortcut}`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {tool.icon}
                  <span className="absolute bottom-0.5 right-0.5 text-[9px] text-white/40 font-medium">
                    {index + 1 === 10 ? "0" : index + 1}
                  </span>
                </motion.button>
              ))}

              {/* Divider before colors */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-px h-6 bg-white/20 mx-1"
              />

              {/* Color Swatches */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-0.5"
              >
                {COLORS.map((color) => (
                  <motion.button
                    key={color.value}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleColorSelect(color.value);
                    }}
                    className={cn(
                      "w-6 h-6 rounded-full transition-all border-2",
                      selectedColor === color.value
                        ? "border-white scale-110 shadow-lg"
                        : "border-transparent hover:border-white/50 hover:scale-105",
                    )}
                    style={{
                      backgroundColor: color.value,
                      boxShadow:
                        selectedColor === color.value
                          ? `0 0 8px ${color.value}`
                          : "none",
                    }}
                    title={color.name}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.9 }}
                  />
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Help text - only shown when tools expanded */}
      <AnimatePresence>
        {isExpanded && !isAIActive && (
          <motion.div
            className="text-center mt-2 text-xs text-gray-500"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, delay: 0.1 }}
          >
            To move canvas, hold{" "}
            <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-200 text-[10px] font-mono mx-0.5">
              Scroll wheel
            </kbd>{" "}
            or{" "}
            <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-200 text-[10px] font-mono mx-0.5">
              Space
            </kbd>{" "}
            while dragging
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
