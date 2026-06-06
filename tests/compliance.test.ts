import { describe, expect, it } from "vitest";
import { demoMarkets } from "@/lib/data/seeds";
import { evaluateCompliance } from "@/lib/compliance/engine";
import { computeForecast } from "@/lib/quant/scoring";

describe("compliance engine", () => {
  it("blocks suspicious private-information language", () => {
    const market = demoMarkets[0];
    const decision = evaluateCompliance({
      market,
      forecast: computeForecast(market, 0.65),
      thesis: {
        summary: "Trade based on leaked confidential inside information.",
        evidence: [
          {
            id: "bad",
            marketId: market.id,
            sourceType: "agent_inference",
            title: "Bad source",
            excerpt: "leaked confidential material nonpublic information",
            credibilityScore: 0.9,
            capturedAt: new Date().toISOString()
          }
        ]
      }
    });
    expect(decision.approved).toBe(false);
    expect(decision.blockedReasons.join(" ")).toMatch(/private|leaked|confidential/i);
  });
});
