import { describe, expect, it, vi } from "vitest";
import { demoMarkets, buildDemoOpportunities } from "@/lib/data/seeds";
import {
  attachBrowserResearchToOpportunity,
  decimalOddsToImpliedProbability,
  inferSportsbookSportKey
} from "@/lib/research/browser-agent";
import type { BrowserResearchReport } from "@/lib/domain";

vi.mock("server-only", () => ({}));

describe("Browser Research Agent", () => {
  it("infers sportsbook sport keys from Kalshi sports markets", () => {
    expect(
      inferSportsbookSportKey({
        ...demoMarkets[0],
        ticker: "KXMLBGAME-26JUN091840LADPIT-PIT",
        title: "Los Angeles D vs Pittsburgh Winner?",
        sector: "sports"
      })
    ).toBe("baseball_mlb");
  });

  it("converts decimal sportsbook odds into implied probability", () => {
    expect(decimalOddsToImpliedProbability(2)).toBe(0.5);
    expect(decimalOddsToImpliedProbability(4)).toBe(0.25);
  });

  it("attaches public browser and sportsbook evidence to an opportunity", () => {
    const opportunity = buildDemoOpportunities([demoMarkets[0]])[0];
    const report: BrowserResearchReport = {
      id: "browser-test",
      marketId: opportunity.market.id,
      ticker: opportunity.market.ticker,
      agentName: "Browser Research Agent",
      status: "complete",
      summary: "Public source and sportsbook check support the thesis.",
      queries: ["test query"],
      sources: [
        {
          id: "browser-source",
          marketId: opportunity.market.id,
          sourceType: "browser_research",
          title: "Public context",
          excerpt: "Public player performance and team context.",
          credibilityScore: 0.8,
          capturedAt: "2026-06-06T20:00:00.000Z"
        }
      ],
      sportsbookComparisons: [
        {
          sportsbook: "ExampleBook",
          marketKey: "h2h",
          outcomeName: "yes",
          decimalOdds: 2,
          impliedProbability: 0.5
        }
      ],
      sportsbookConsensusProbability: 0.5,
      kalshiMarketProbability: opportunity.forecast.marketProbability,
      fairPricingNote: "Sportsbook consensus is above Kalshi.",
      blockers: [],
      createdAt: "2026-06-06T20:00:00.000Z"
    };

    const enriched = attachBrowserResearchToOpportunity(opportunity, report);
    expect(enriched.browserResearch?.status).toBe("complete");
    expect(enriched.thesis.evidence.some((item) => item.sourceType === "browser_research")).toBe(true);
    expect(enriched.debate.some((turn) => turn.agent === "Browser Research Agent")).toBe(true);
  });
});
