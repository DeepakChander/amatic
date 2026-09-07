/**
 * Spatial Memory System
 *
 * Remembers AI explanations for each canvas element and tracks conversation flow.
 * Enables contextual follow-up questions and spatial references.
 * Memory is persisted across page reloads via idb-keyval.
 */

import { get, set } from "idb-keyval";

export interface ElementMemory {
  elementId: string;
  explanation: string;
  relatedConcepts: string[];
  createdAt: number;
  lastAccessed: number;
  interactions: Interaction[];
  topic: string;
  /** How many times this topic has been explained to the student. Used to escalate depth. */
  timesExplained: number;
}

export interface Interaction {
  timestamp: number;
  query: string;
  response: string;
  gestureType?: string;
}

export interface ConversationNode {
  id: string;
  timestamp: number;
  topic: string;
  elementIds: string[];
  previousTopic?: string;
  relationship?: string;
  userQuery: string;
  aiResponse: string;
}

/**
 * Spatial Memory - Remembers context for each canvas element
 */
export class SpatialMemory {
  private elementMemory: Map<string, ElementMemory> = new Map();
  private conversationFlow: ConversationNode[] = [];
  private maxMemorySize = 100;

  /**
   * Remember AI's explanation for an element
   */
  rememberElement(
    elementId: string,
    explanation: string,
    relatedConcepts: string[] = [],
    topic: string = "general",
  ): void {
    const existing = this.elementMemory.get(elementId);

    if (existing) {
      // Update existing memory
      existing.explanation = explanation;
      existing.relatedConcepts = [
        ...new Set([...existing.relatedConcepts, ...relatedConcepts]),
      ];
      existing.lastAccessed = Date.now();
      existing.timesExplained = (existing.timesExplained ?? 0) + 1;
    } else {
      // Create new memory
      this.elementMemory.set(elementId, {
        elementId,
        explanation,
        relatedConcepts,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        interactions: [],
        topic,
        timesExplained: 1,
      });
    }

    // Cleanup old memories
    if (this.elementMemory.size > this.maxMemorySize) {
      this.cleanupOldMemories();
    }
  }

  /**
   * Record an interaction with an element
   */
  recordInteraction(
    elementId: string,
    query: string,
    response: string,
    gestureType?: string,
  ): void {
    const memory = this.elementMemory.get(elementId);
    if (memory) {
      memory.interactions.push({
        timestamp: Date.now(),
        query,
        response,
        gestureType,
      });
      memory.lastAccessed = Date.now();
    }
  }

  /**
   * Recall previous explanation for element
   */
  recall(elementId: string): string | null {
    const memory = this.elementMemory.get(elementId);
    if (!memory) {
      return null;
    }

    memory.lastAccessed = Date.now();
    return memory.explanation;
  }

  /**
   * Get full memory context for element
   */
  getElementContext(elementId: string): string {
    const memory = this.elementMemory.get(elementId);
    if (!memory) {
      return "";
    }

    const timeAgo = Math.floor((Date.now() - memory.createdAt) / 1000);

    let context = `PREVIOUS EXPLANATION OF THIS ELEMENT:\n`;
    context += `"${memory.explanation}"\n\n`;
    context += `You explained this ${timeAgo}s ago.\n`;

    if (memory.interactions.length > 0) {
      context += `\nPREVIOUS INTERACTIONS:\n`;
      memory.interactions.slice(-3).forEach((interaction) => {
        const interactionTimeAgo = Math.floor(
          (Date.now() - interaction.timestamp) / 1000,
        );
        context += `- ${interactionTimeAgo}s ago: User asked "${interaction.query}"\n`;
      });
    }

    if (memory.relatedConcepts.length > 0) {
      context += `\nRELATED CONCEPTS: ${memory.relatedConcepts.join(", ")}\n`;
    }

    context += `\nUser is now asking a follow-up question about this element.\n`;

    return context;
  }

  /**
   * Get relevant context based on current situation
   */
  getRelevantContext(elementId?: string): string {
    if (elementId) {
      return this.getElementContext(elementId);
    }

    // Return recent conversation context
    return this.getConversationContext();
  }

  /**
   * Add to conversation flow
   */
  addToConversationFlow(
    userQuery: string,
    aiResponse: string,
    elementIds: string[] = [],
    topic: string = "general",
  ): void {
    const node: ConversationNode = {
      id: `conv-${Date.now()}`,
      timestamp: Date.now(),
      topic,
      elementIds,
      userQuery,
      aiResponse,
    };

    // Link to previous conversation
    if (this.conversationFlow.length > 0) {
      const previous = this.conversationFlow[this.conversationFlow.length - 1];
      node.previousTopic = previous.topic;
      node.relationship = this.detectTopicRelationship(previous.topic, topic);
    }

    this.conversationFlow.push(node);

    // Keep only recent conversation
    if (this.conversationFlow.length > 50) {
      this.conversationFlow.shift();
    }
  }

  /**
   * Get conversation context for AI
   */
  getConversationContext(): string {
    if (this.conversationFlow.length === 0) {
      return "New conversation - no previous context";
    }

    let context = "CONVERSATION FLOW:\n";

    this.conversationFlow.slice(-5).forEach((node, i) => {
      const timeAgo = Math.floor((Date.now() - node.timestamp) / 1000);
      context += `${i + 1}. ${timeAgo}s ago: Topic "${node.topic}"`;

      if (node.relationship) {
        context += ` (${node.relationship} to previous)`;
      }

      context += `\n   User: "${node.userQuery.substring(0, 50)}..."\n`;
    });

    context += `\nThis shows the student's learning journey and helps you provide coherent follow-ups.\n`;

    // Determine depth level from the most-explained topic in recent conversation
    const maxExplained = Math.max(
      0,
      ...this.conversationFlow.slice(-5).map((n) => {
        const mem = this.elementMemory.get(n.elementIds[0]);
        return mem?.timesExplained ?? 0;
      }),
    );
    if (maxExplained >= 3) {
      context =
        `DEPTH LEVEL: Advanced (this topic has been explained ${maxExplained} times — ` +
        `go significantly deeper, connect to related concepts, use technical vocabulary).\n\n` +
        context;
    } else if (maxExplained === 2) {
      context =
        `DEPTH LEVEL: Intermediate (explained once before — ` +
        `build on the previous explanation and add more mechanistic detail).\n\n` +
        context;
    }

    return context;
  }

  /**
   * Detect relationship between topics
   */
  private detectTopicRelationship(
    previousTopic: string,
    currentTopic: string,
  ): string {
    // Simple keyword matching (can be enhanced with NLP)
    const prev = previousTopic.toLowerCase();
    const curr = currentTopic.toLowerCase();

    // Same topic
    if (prev === curr) {
      return "continuation";
    }

    // Related topics
    const biologyConcepts = [
      "cell",
      "dna",
      "mitochondria",
      "chloroplast",
      "nucleus",
    ];
    const isPrevBiology = biologyConcepts.some((c) => prev.includes(c));
    const isCurrBiology = biologyConcepts.some((c) => curr.includes(c));

    if (isPrevBiology && isCurrBiology) {
      return "related-topic";
    }

    // Follow-up question
    if (curr.includes(prev) || prev.includes(curr)) {
      return "follow-up";
    }

    return "new-topic";
  }

  /**
   * Find related elements by topic
   */
  findRelatedElements(topic: string): ElementMemory[] {
    const related: ElementMemory[] = [];

    this.elementMemory.forEach((memory) => {
      if (
        memory.topic === topic ||
        memory.relatedConcepts.some((c) =>
          c.toLowerCase().includes(topic.toLowerCase()),
        )
      ) {
        related.push(memory);
      }
    });

    return related;
  }

  /**
   * Get summary of what AI has explained
   */
  getSummary(): string {
    const topics = new Set(
      Array.from(this.elementMemory.values()).map((m) => m.topic),
    );

    return `
MEMORY SUMMARY:
- Total elements explained: ${this.elementMemory.size}
- Topics covered: ${Array.from(topics).join(", ")}
- Conversation turns: ${this.conversationFlow.length}
- Session duration: ${this.getSessionDuration()}s
`;
  }

  /**
   * Get session duration
   */
  private getSessionDuration(): number {
    if (this.conversationFlow.length === 0) {
      return 0;
    }

    const first = this.conversationFlow[0].timestamp;
    const last =
      this.conversationFlow[this.conversationFlow.length - 1].timestamp;

    return Math.floor((last - first) / 1000);
  }

  /**
   * Cleanup old memories (LRU eviction)
   */
  private cleanupOldMemories(): void {
    // Sort by last accessed time
    const sorted = Array.from(this.elementMemory.entries()).sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed,
    );

    // Remove oldest 20%
    const toRemove = Math.floor(sorted.length * 0.2);
    sorted.slice(0, toRemove).forEach(([id]) => {
      this.elementMemory.delete(id);
    });
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.elementMemory.clear();
    this.conversationFlow = [];
  }

  // -------------------------------------------------------------------------
  // Persistence (idb-keyval)
  // -------------------------------------------------------------------------

  private static readonly STORAGE_KEY = "amatic-spatial-memory";

  /**
   * Load memory from IndexedDB (from a previous session).
   * Call once on app mount — non-blocking.
   */
  async initFromStorage(): Promise<void> {
    try {
      const saved = await get(SpatialMemory.STORAGE_KEY);
      if (saved) this.import(saved);
    } catch {
      // Storage unavailable — proceed with fresh memory
    }
  }

  /**
   * Persist current memory to IndexedDB.
   * Call after each teaching session and on page unload.
   */
  async saveToStorage(): Promise<void> {
    try {
      await set(SpatialMemory.STORAGE_KEY, this.export());
    } catch {
      // Ignore storage failures silently
    }
  }

  /**
   * Export memory for persistence
   */
  export(): any {
    return {
      elements: Array.from(this.elementMemory.entries()),
      conversation: this.conversationFlow,
    };
  }

  /**
   * Import memory from persistence
   */
  import(data: any): void {
    if (data.elements) {
      this.elementMemory = new Map(data.elements);
    }
    if (data.conversation) {
      this.conversationFlow = data.conversation;
    }
  }
}

/**
 * Global spatial memory instance
 */
let globalMemory: SpatialMemory | null = null;

export function getSpatialMemory(): SpatialMemory {
  if (!globalMemory) {
    globalMemory = new SpatialMemory();
  }
  return globalMemory;
}

// Default export
export default {
  SpatialMemory,
  getSpatialMemory,
};
