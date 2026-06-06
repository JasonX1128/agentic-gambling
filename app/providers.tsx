"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CopilotKitContext,
  CopilotKitCoreReact,
  type CopilotKitContextValue
} from "@copilotkit/react-core/v2/context";
import { EventFundCopilotPanel } from "@/components/copilot/EventFundCopilotPanel";

const COPILOT_PUBLIC_KEY_HEADER = "X-CopilotCloud-Public-Api-Key";
const RUNTIME_URL = "/api/copilotkit";

export function Providers({ children }: { children: React.ReactNode }) {
  const copilotPublicKey =
    process.env.NEXT_PUBLIC_COPILOTKIT_LICENSE_KEY || process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY;
  const headers = useMemo<Record<string, string>>(
    () => {
      const nextHeaders: Record<string, string> = {};
      if (copilotPublicKey) {
        nextHeaders[COPILOT_PUBLIC_KEY_HEADER] = copilotPublicKey;
      }
      return nextHeaders;
    },
    [copilotPublicKey]
  );
  const copilotkitRef = useRef<CopilotKitCoreReact | null>(null);
  if (copilotkitRef.current === null) {
    copilotkitRef.current = new CopilotKitCoreReact({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "auto",
      headers,
      properties: {},
      tools: [],
      renderToolCalls: [],
      renderActivityMessages: [],
      renderCustomMessages: []
    });
  }
  const copilotkit = copilotkitRef.current;
  const [executingToolCallIds, setExecutingToolCallIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    copilotkit.setRuntimeUrl(RUNTIME_URL);
    copilotkit.setRuntimeTransport("auto");
    copilotkit.setHeaders(headers);
  }, [copilotkit, headers]);

  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onError: ({ code, error, context }) => {
        console.error("[copilotkit]", code, error, context);
      },
      onToolExecutionStart: ({ toolCallId }) => {
        setExecutingToolCallIds((previous) => {
          if (previous.has(toolCallId)) {
            return previous;
          }
          const next = new Set(previous);
          next.add(toolCallId);
          return next;
        });
      },
      onToolExecutionEnd: ({ toolCallId }) => {
        setExecutingToolCallIds((previous) => {
          if (!previous.has(toolCallId)) {
            return previous;
          }
          const next = new Set(previous);
          next.delete(toolCallId);
          return next;
        });
      }
    });
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  const contextValue = useMemo<CopilotKitContextValue>(
    () => ({
      copilotkit,
      executingToolCallIds
    }),
    [copilotkit, executingToolCallIds]
  );

  return (
    <CopilotKitContext.Provider value={contextValue}>
      {children}
      <EventFundCopilotPanel />
    </CopilotKitContext.Provider>
  );
}
