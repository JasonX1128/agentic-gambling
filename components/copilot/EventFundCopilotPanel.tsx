"use client";

import { FormEvent, useMemo, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import { useAgent } from "@copilotkit/react-core/v2/headless";

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          return String(part.text);
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (content == null) {
    return "";
  }
  return JSON.stringify(content);
}

function makeMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function EventFundCopilotPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { agent } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();

  const visibleMessages = useMemo(() => agent.messages.slice(-8), [agent.messages]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || agent.isRunning) {
      return;
    }
    setInput("");
    setError(null);
    agent.addMessage({
      id: makeMessageId(),
      role: "user",
      content: text
    });
    try {
      await copilotkit.runAgent({ agent });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CopilotKit request failed.");
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3">
      {open ? (
        <section className="flex h-[560px] max-h-[calc(100vh-2rem)] w-[390px] max-w-full flex-col overflow-hidden rounded-lg border border-line bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-ink">EventFund Copilot</div>
              <div className="text-xs text-slate-500">CopilotKit control plane</div>
            </div>
            <button
              aria-label="Close EventFund Copilot"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-ink"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-[#f7f8fa] p-4 text-sm">
            {visibleMessages.length ? (
              visibleMessages.map((message) => (
                <div key={message.id} className={message.role === "user" ? "text-right" : "text-left"}>
                  <div
                    className={
                      message.role === "user"
                        ? "ml-auto inline-block max-w-[88%] rounded-md bg-signal px-3 py-2 text-left text-white"
                        : "inline-block max-w-[88%] rounded-md border border-line bg-white px-3 py-2 text-slate-800"
                    }
                  >
                    {messageText(message.content)}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-line bg-white p-3 text-xs leading-5 text-slate-600">
                Ask about blocked trades, high-liquidity opportunities, risk limits, PnL by sector, CIO memos,
                or paper trade approvals.
              </div>
            )}
            {agent.isRunning ? <div className="text-xs font-medium text-slate-500">Thinking...</div> : null}
            {error ? <div className="rounded-md border border-danger bg-red-50 p-2 text-xs text-danger">{error}</div> : null}
          </div>

          <form className="flex gap-2 border-t border-line bg-white p-3" onSubmit={submit}>
            <input
              aria-label="Ask EventFund Copilot"
              className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-signal"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask EventFund OS..."
              value={input}
            />
            <button
              aria-label="Send to EventFund Copilot"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-ink text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!input.trim() || agent.isRunning}
              type="submit"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </section>
      ) : null}

      <button
        aria-label="Open EventFund Copilot"
        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white shadow-xl hover:bg-slate-800"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <MessageCircle className="h-5 w-5" />
      </button>
    </div>
  );
}
