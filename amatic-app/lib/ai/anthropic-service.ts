/**
 * Anthropic Service - Wrapper for Anthropic API calls via Express backend
 */

export interface AnthropicMessage {
  role: string;
  content: string;
}

export interface AnthropicResponse {
  content: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

const getApiBase = (): string => {
  if (typeof window !== "undefined" && (import.meta as any).env?.VITE_APP_AI_BACKEND) {
    return (import.meta as any).env.VITE_APP_AI_BACKEND;
  }
  return "";
};

export async function generateAnthropicResponse(
  messages: AnthropicMessage[] | string,
  systemPrompt?: string,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<AnthropicResponse> {
  const messageArray =
    typeof messages === "string"
      ? [{ role: "user", content: messages }]
      : messages;

  const lastMessage = messageArray[messageArray.length - 1]?.content || "";

  const base = getApiBase();
  const url = base ? `${base}/api/ai/chat` : "/api/ai/chat";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: lastMessage,
      canvasContext: null,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || "AI request failed");
  }

  const data = await response.json();
  return {
    content: data.response ?? "",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}

export async function streamAnthropicResponse(
  prompt: string,
  onChunk: (chunk: string) => void,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<void> {
  const base = getApiBase();
  const url = base ? `${base}/api/ai/master` : "/api/ai/master";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: prompt,
      canvasContext: null,
      userIntent: "stream",
    }),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Stream request failed: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "stream_chunk" && payload.content) {
              onChunk(payload.content);
            }
          } catch {
            // ignore parse errors for non-JSON SSE lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
