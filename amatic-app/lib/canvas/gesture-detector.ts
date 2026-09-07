/**
 * Gesture Detector - Detects user gestures and patterns on the canvas
 */

export type GestureType =
  | "tap"
  | "double_tap"
  | "long_press"
  | "swipe"
  | "pinch"
  | "rotate"
  | "circle"
  | "line"
  | "underline"
  | "point";

export interface DetectedGesture {
  type: GestureType;
  startX: number;
  startY: number;
  endX?: number;
  endY?: number;
  timestamp: number;
  duration?: number;
  velocity?: number;
  targetElementId?: string;
}

export interface GesturePattern {
  gestures: DetectedGesture[];
  recognizedAs?: string;
  confidence: number;
}

class GestureDetector {
  private activeGesture: Partial<DetectedGesture> | null = null;
  private gestureHistory: DetectedGesture[] = [];

  startGesture(x: number, y: number): void {
    this.activeGesture = {
      startX: x,
      startY: y,
      timestamp: Date.now(),
    };
  }

  updateGesture(x: number, y: number): void {
    if (this.activeGesture) {
      this.activeGesture.endX = x;
      this.activeGesture.endY = y;
    }
  }

  endGesture(): DetectedGesture | null {
    if (!this.activeGesture) return null;

    const gesture = this.recognizeGesture(this.activeGesture);
    if (gesture) {
      this.gestureHistory.push(gesture);
      if (this.gestureHistory.length > 50) {
        this.gestureHistory.shift();
      }
    }

    this.activeGesture = null;
    return gesture;
  }

  private recognizeGesture(
    partial: Partial<DetectedGesture>,
  ): DetectedGesture | null {
    if (!partial.startX || !partial.startY || !partial.timestamp) return null;

    const duration = Date.now() - partial.timestamp;
    const endX = partial.endX || partial.startX;
    const endY = partial.endY || partial.startY;

    const dx = endX - partial.startX;
    const dy = endY - partial.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let type: GestureType = "tap";

    if (distance < 10 && duration > 500) {
      type = "long_press";
    } else if (distance > 50) {
      type = "swipe";
    }

    return {
      type,
      startX: partial.startX,
      startY: partial.startY,
      endX,
      endY,
      timestamp: partial.timestamp,
      duration,
      velocity: distance / Math.max(duration, 1),
    };
  }

  getRecentGestures(count: number = 10): DetectedGesture[] {
    return this.gestureHistory.slice(-count);
  }
}

export const gestureDetector = new GestureDetector();
