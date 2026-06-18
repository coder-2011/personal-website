import type { APIRoute } from "astro";

import systemPrompt from "../../sysprompt.md?raw";

export const prerender = false;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "qwen/qwen3.7-plus";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function cleanMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((message): message is ChatMessage => {
      if (!message || typeof message !== "object") {
        return false;
      }

      const role = (message as ChatMessage).role;
      const content = (message as ChatMessage).content;

      return (
        (role === "user" || role === "assistant") &&
        typeof content === "string" &&
        content.trim().length > 0
      );
    })
    .slice(-24)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000)
    }));
}

function pullDelta(line: string) {
  const trimmed = line.trim();

  if (!trimmed.startsWith("data:")) {
    return null;
  }

  const data = trimmed.slice(5).trim();

  if (!data || data === "[DONE]") {
    return data;
  }

  const payload = JSON.parse(data);
  const content = payload?.choices?.[0]?.delta?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }

  return null;
}

async function callOpenRouter(apiKey: string, messages: ChatMessage[]) {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://naman.world/troll",
      "X-Title": "naman.world/troll"
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages]
    })
  });
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return new Response("OPENROUTER_API_KEY is missing.", { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const messages = cleanMessages(body?.messages);

  if (!messages.length) {
    return new Response("Message is required.", { status: 400 });
  }

  const upstream = await callOpenRouter(apiKey, messages);

  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text().catch(() => "OpenRouter failed."), {
      status: upstream.status || 502
    });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const delta = pullDelta(line);

            if (delta === "[DONE]") {
              controller.close();
              return;
            }

            if (delta) {
              controller.enqueue(encoder.encode(delta));
            }
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
};
