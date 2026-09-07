/**
 * Agentic Service - Handles AI agent behaviors and autonomous actions
 * Delegates to Express backend (Master AI / Chat endpoints)
 */

const getApiBase = (): string => {
  if (typeof window !== "undefined" && (import.meta as any).env?.VITE_APP_AI_BACKEND) {
    return (import.meta as any).env.VITE_APP_AI_BACKEND;
  }
  return "";
};

export interface AgentAction {
  type: "create" | "modify" | "delete" | "speak";
  target?: string;
  data?: any;
}

export interface AgentState {
  isActive: boolean;
  currentTask?: string;
  lastAction?: AgentAction;
}

export interface AgenticResponse {
  content: string;
  actions?: AgentAction[];
}

export async function generateAgenticResponse(
  prompt: string,
  context?: any,
): Promise<AgenticResponse> {
  const base = getApiBase();
  const url = base ? `${base}/api/ai/chat` : "/api/ai/chat";

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: prompt,
      canvasContext: context ?? null,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || "Agentic request failed");
  }

  const data = await response.json();
  return {
    content: data.response ?? "",
    actions: [],
  };
}

export class AgenticService {
  private state: AgentState = {
    isActive: false,
  };

  async executeAgentAction(action: AgentAction): Promise<boolean> {
    this.state.lastAction = action;
    return true;
  }

  getState(): AgentState {
    return { ...this.state };
  }

  activate(): void {
    this.state.isActive = true;
  }

  deactivate(): void {
    this.state.isActive = false;
  }
}

export const agenticService = new AgenticService();
