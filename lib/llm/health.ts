import type { IntegrationStatus } from "@/lib/domain";
import { getEnv } from "@/lib/config/env";

function modelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/models`;
  return url.toString();
}

export async function copilotKitHealth(): Promise<IntegrationStatus> {
  const env = getEnv();

  if (env.LLM_PROVIDER === "openai") {
    return {
      name: "CopilotKit",
      state: env.OPENAI_API_KEY ? "complete" : "blocked",
      detail: env.OPENAI_API_KEY
        ? `CopilotKit runtime is configured for OpenAI model ${env.OPENAI_MODEL}.`
        : "CopilotKit runtime is configured for OpenAI, but OPENAI_API_KEY is missing.",
      required: ["OPENAI_API_KEY"],
      remediation: ["Set LLM_PROVIDER=ollama for a free local model or set OPENAI_API_KEY for OpenAI."]
    };
  }

  if (env.LLM_PROVIDER === "none") {
    return {
      name: "CopilotKit",
      state: "blocked",
      detail: "CopilotKit runtime is present, but model-backed chat is disabled by LLM_PROVIDER=none.",
      required: ["LLM_PROVIDER=ollama or LLM_PROVIDER=openai"],
      remediation: ["Set LLM_PROVIDER=ollama and start Ollama for free local chat."]
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(modelsUrl(env.OLLAMA_BASE_URL), { signal: controller.signal }).finally(() =>
      clearTimeout(timeout)
    );

    if (!response.ok) {
      return {
        name: "CopilotKit",
        state: "blocked",
        detail: `Ollama responded with HTTP ${response.status} at ${env.OLLAMA_BASE_URL}.`,
        required: ["Ollama running locally", "OLLAMA_MODEL pulled locally"],
        remediation: ["Run: ollama serve", `Run: ollama pull ${env.OLLAMA_MODEL}`]
      };
    }

    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = body.data?.map((model) => model.id).filter(Boolean) ?? [];
    const modelAvailable = models.includes(env.OLLAMA_MODEL);

    return {
      name: "CopilotKit",
      state: modelAvailable ? "complete" : "blocked",
      detail: modelAvailable
        ? `CopilotKit runtime is configured for free local Ollama via ${env.OLLAMA_BASE_URL} using ${env.OLLAMA_MODEL}.`
        : `Ollama is running, but ${env.OLLAMA_MODEL} is not installed locally.`,
      required: ["Ollama running locally", "OLLAMA_MODEL pulled locally"],
      remediation: modelAvailable ? [] : [`Run: ollama pull ${env.OLLAMA_MODEL}`]
    };
  } catch (error) {
    return {
      name: "CopilotKit",
      state: "blocked",
      detail: `Ollama unavailable at ${env.OLLAMA_BASE_URL}: ${error instanceof Error ? error.message : "connection failed"}.`,
      required: ["Ollama running locally", "OLLAMA_MODEL pulled locally"],
      remediation: ["Install Ollama.", "Run: ollama serve", `Run: ollama pull ${env.OLLAMA_MODEL}`]
    };
  }
}
