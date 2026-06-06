import { getEnv, boolEnv } from "@/lib/config/env";

export type WeaveState =
  | { enabled: true; client: unknown; project: string }
  | { enabled: false; reason: "missing_credentials" | "disabled" | "init_failed"; error?: string };

let cachedState: Promise<WeaveState> | undefined;

export function redactForTrace<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  return JSON.parse(
    JSON.stringify(value, (key, item) => {
      if (/key|secret|signature|authorization|private/i.test(key)) return "[redacted]";
      return item;
    })
  ) as T;
}

export async function initWeave(): Promise<WeaveState> {
  if (cachedState) return cachedState;
  cachedState = (async () => {
    const env = getEnv();
    const project = env.WEAVE_PROJECT || env.WANDB_PROJECT;
    if (boolEnv(env.WEAVE_DISABLED)) return { enabled: false, reason: "disabled" };
    if (!env.WANDB_API_KEY || !project) return { enabled: false, reason: "missing_credentials" };
    try {
      const weave = await import("weave");
      const client = await weave.init(env.WANDB_ENTITY ? `${env.WANDB_ENTITY}/${project}` : project);
      return { enabled: true, client, project };
    } catch (error) {
      return {
        enabled: false,
        reason: "init_failed",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  })();
  return cachedState;
}

export async function traceAsync<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T & { traceId?: string }> {
  const state = await initWeave();
  const traceId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!state.enabled) {
    const value = await fn();
    if (value && typeof value === "object") return { ...(value as object), traceId } as T & { traceId?: string };
    return value as T & { traceId?: string };
  }
  const weave = await import("weave");
  const op = weave.op(async (_input: unknown) => fn(), { name });
  const value = await op(redactForTrace(input));
  if (value && typeof value === "object") return { ...(value as object), traceId } as T & { traceId?: string };
  return value as T & { traceId?: string };
}
