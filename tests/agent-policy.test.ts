import { describe, expect, it } from "vitest";
import { hydrateAgentPolicy } from "@/lib/agents/policy";
import { agentHierarchy } from "@/lib/data/seeds";

describe("agent management policy", () => {
  it("hydrates top-level fund agents by name when their role is descriptive", () => {
    const agent = hydrateAgentPolicy({
      id: "cio",
      name: "CIO / Senior PM Agent",
      role: "Allocates capital across sector pods and approves trade recommendations.",
      status: "running",
      lastDecision: "Reviewing slate."
    });
    expect(agent.operatingMode).toBe("approve");
    expect(agent.decisionRights).toContain("Allocate paper risk budget");
    expect(agent.systemPrompt).toMatch(/fund CIO/i);
  });

  it("shows the fired compliance executive as replaced by an interim compliance officer", () => {
    const complianceSeat = agentHierarchy.find((agent) => agent.id === "cco");

    expect(complianceSeat?.name).toBe("Interim Compliance Officer Agent");
    expect(complianceSeat?.systemPrompt).toMatch(/interim compliance/i);
    expect(complianceSeat?.lastDecision).toMatch(/Compliance gate remains non-bypassable/i);
  });
});
