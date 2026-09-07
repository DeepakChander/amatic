/**
 * Activity Stream - Tracks user activity on the canvas
 */

export type ActivityType =
  | "create"
  | "modify"
  | "delete"
  | "select"
  | "move"
  | "resize"
  | "zoom"
  | "pan";

export interface ActivityEvent {
  type: ActivityType;
  timestamp: number;
  elementId?: string;
  data?: any;
}

export interface ActivitySummary {
  recentActions: string[];
  totalActions: number;
  dominantActivity?: ActivityType;
}

class ActivityStream {
  private events: ActivityEvent[] = [];
  private maxEvents: number = 100;

  track(event: Omit<ActivityEvent, "timestamp">): void {
    this.events.push({
      ...event,
      timestamp: Date.now(),
    });

    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  getRecentEvents(count: number = 10): ActivityEvent[] {
    return this.events.slice(-count);
  }

  getEventsSince(timestamp: number): ActivityEvent[] {
    return this.events.filter((event) => event.timestamp >= timestamp);
  }

  clear(): void {
    this.events = [];
  }

  getActivitySummary(): ActivitySummary {
    const recentEvents = this.events.slice(-10);
    const recentActions = recentEvents.map(
      (e) => `${e.type}${e.elementId ? ` on ${e.elementId}` : ""}`,
    );

    // Find dominant activity
    const counts: Partial<Record<ActivityType, number>> = {};
    recentEvents.forEach((event) => {
      counts[event.type] = (counts[event.type] || 0) + 1;
    });

    let dominantActivity: ActivityType | undefined;
    let maxCount = 0;
    for (const [type, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantActivity = type as ActivityType;
      }
    }

    return {
      recentActions,
      totalActions: this.events.length,
      dominantActivity,
    };
  }
}

export const activityStream = new ActivityStream();
