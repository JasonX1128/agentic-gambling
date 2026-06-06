import { describe, expect, it } from "vitest";
import {
  canRole,
  evaluatePolicyChange,
  getAgentOperatingPolicy,
  policySummary,
  requiredPermissionForSection
} from "@/lib/agents/operating-policy";

describe("agent operating policy", () => {
  it("loads the editable policy file and summarizes protected surfaces", () => {
    const policy = getAgentOperatingPolicy();
    const summary = policySummary(policy);

    expect(summary.configPath).toContain("config/agent-operating-policy.json");
    expect(summary.editableSections).toEqual(["agentPolicies", "fundGovernance", "paperCycle", "executiveRoster"]);
    expect(summary.protectedKeys).toContain("GLOBAL_KILL_SWITCH");
    expect(summary.executiveSeatCount).toBeGreaterThanOrEqual(5);
    expect(policy.agentPolicies.length).toBeGreaterThan(5);
  });

  it("allows broad proposal rights without broad apply rights", () => {
    const policy = getAgentOperatingPolicy();
    const proposedGovernance = {
      ...policy.fundGovernance,
      reviewHours: {
        ...policy.fundGovernance.reviewHours,
        default: policy.fundGovernance.reviewHours.default + 1
      }
    };

    const proposal = evaluatePolicyChange(
      {
        actorRole: "Sector PM Agent",
        section: "fundGovernance",
        value: proposedGovernance,
        reason: "Sector PM proposes a slower review cadence after excess churn."
      },
      "propose",
      policy
    );
    const apply = evaluatePolicyChange(
      {
        actorRole: "Sector PM Agent",
        section: "fundGovernance",
        value: proposedGovernance,
        reason: "Sector PM attempts to apply governance without committee permission."
      },
      "apply",
      policy
    );

    expect(proposal.ok).toBe(true);
    expect(apply.ok).toBe(false);
    expect(apply.requiredPermission).toBe("apply_governance_policy");
  });

  it("permits only section-specific policy owners to apply valid edits", () => {
    const policy = getAgentOperatingPolicy();
    const proposedPaperCycle = {
      ...policy.paperCycle,
      scoring: {
        ...policy.paperCycle.scoring,
        confidenceWeight: policy.paperCycle.scoring.confidenceWeight + 1
      }
    };

    const evaluation = evaluatePolicyChange(
      {
        actorRole: "Calibration Agent",
        section: "paperCycle",
        value: proposedPaperCycle,
        reason: "Calibration raises confidence weight after settled samples improve."
      },
      "apply",
      policy
    );

    expect(requiredPermissionForSection("paperCycle")).toBe("apply_paper_cycle_policy");
    expect(canRole("Calibration Agent", "apply_paper_cycle_policy", policy)).toBe(true);
    expect(evaluation.ok).toBe(true);
  });

  it("allows executive replacement while blocking vacant protected control seats", () => {
    const policy = getAgentOperatingPolicy();
    const complianceSeat = policy.executiveRoster.seats.find((seat) => seat.seat === "compliance");
    const vacantRoster = {
      ...policy.executiveRoster,
      seats: policy.executiveRoster.seats.map((seat) =>
        seat.seat === "compliance" ? { ...seat, status: "vacant" as const, currentAgentName: "Vacant Compliance Seat" } : seat
      )
    };

    const currentRoster = evaluatePolicyChange(
      {
        actorRole: "CIO / Senior PM Agent",
        section: "executiveRoster",
        value: policy.executiveRoster,
        reason: "CIO records compliance executive replacement with interim coverage."
      },
      "apply",
      policy
    );
    const vacantCompliance = evaluatePolicyChange(
      {
        actorRole: "CIO / Senior PM Agent",
        section: "executiveRoster",
        value: vacantRoster,
        reason: "Attempt to leave compliance vacant should fail."
      },
      "apply",
      policy
    );

    expect(complianceSeat?.currentAgentName).toBe("Interim Compliance Officer Agent");
    expect(currentRoster.ok).toBe(true);
    expect(vacantCompliance.ok).toBe(false);
  });

  it("rejects malformed section payloads before a file write", () => {
    const policy = getAgentOperatingPolicy();
    const evaluation = evaluatePolicyChange(
      {
        actorRole: "CIO / Senior PM Agent",
        section: "paperCycle",
        value: { scoring: {} },
        reason: "Malformed payload should not be accepted."
      },
      "apply",
      policy
    );

    expect(evaluation.ok).toBe(false);
  });
});
