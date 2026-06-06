import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAgentAutomationConfig, getEnv } from "@/lib/config/env";

type OperatorAuthResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      body: {
        blocked: true;
        code: string;
        error: string;
        remediation: string[];
      };
    };

export function requireOperatorAuth(req: NextRequest): OperatorAuthResult {
  const automation = getAgentAutomationConfig();
  if (!automation.operatorAuthRequired) return { ok: true };

  const env = getEnv();
  if (!env.OPERATOR_API_TOKEN) {
    return {
      ok: false,
      status: 503,
      body: {
        blocked: true,
        code: "OPERATOR_API_TOKEN_REQUIRED",
        error: "Production operator access control is enabled, but OPERATOR_API_TOKEN is not configured.",
        remediation: [
          "Set OPERATOR_API_TOKEN to a strong secret in the deployment environment.",
          "Send mutating API requests with Authorization: Bearer <OPERATOR_API_TOKEN>."
        ]
      }
    };
  }

  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? req.headers.get("x-operator-token");
  if (token === env.OPERATOR_API_TOKEN) return { ok: true };

  return {
    ok: false,
    status: 401,
    body: {
      blocked: true,
      code: "OPERATOR_AUTH_REQUIRED",
      error: "This operation requires an operator token.",
      remediation: ["Send Authorization: Bearer <OPERATOR_API_TOKEN> or x-operator-token from a trusted operator client."]
    }
  };
}

export function operatorAuthResponse(req: NextRequest): NextResponse | undefined {
  const result = requireOperatorAuth(req);
  return result.ok ? undefined : NextResponse.json(result.body, { status: result.status });
}
