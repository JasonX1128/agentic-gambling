import {
  BuiltInAgent,
  CopilotRuntime,
  convertMessagesToVercelAISDKMessages,
  convertToolsToVercelAITools,
  createCopilotRuntimeHandler
} from "@copilotkit/runtime/v2";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, stepCountIs } from "ai";
import { getEnv } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = [
  "You are the EventFund OS trading command center copilot.",
  "You help inspect Kalshi event-contract opportunities, paper trades, portfolio state, risk, compliance, and CIO memos.",
  "Use public information only. Do not suggest trades based on private, leaked, confidential, restricted-person, or manipulative information.",
  "Never claim a live order is safe to place unless the configured live-trading gate, risk checks, compliance checks, and kill switch all allow it.",
  "Paper trading is the default mode. Be explicit when an action only approves or records a paper trade."
].join("\n");

function getLanguageModel() {
  const env = getEnv();

  if (env.LLM_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return createOpenAI({ apiKey: env.OPENAI_API_KEY })(env.OPENAI_MODEL);
  }

  const ollama = createOpenAI({
    apiKey: env.OLLAMA_API_KEY,
    baseURL: env.OLLAMA_BASE_URL
  });

  return ollama(env.OLLAMA_MODEL);
}

const defaultAgent = new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    const messages = convertMessagesToVercelAISDKMessages(input.messages);
    const tools = convertToolsToVercelAITools(input.tools);

    return streamText({
      model: getLanguageModel(),
      system: SYSTEM_PROMPT,
      messages,
      tools,
      abortSignal,
      stopWhen: stepCountIs(5)
    });
  }
});

const copilotRuntime = new CopilotRuntime({
  agents: {
    default: defaultAgent
  }
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit"
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
