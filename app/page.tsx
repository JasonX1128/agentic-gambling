import { CommandCenter } from "@/components/CommandCenter";
import { runDemoWorkflow } from "@/lib/agents/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page() {
  const demo = await runDemoWorkflow();
  return <CommandCenter initialData={demo} />;
}
