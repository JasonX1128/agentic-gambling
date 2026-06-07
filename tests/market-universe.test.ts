import { describe, expect, it } from "vitest";
import { classifyTradingUniversePod, isExcludedTradingUniverseMarket, isPaperScanCandidate, selectDiverseMarketUniverse } from "@/lib/markets/universe";
import { demoMarkets } from "@/lib/data/seeds";

describe("market trading universe", () => {
  it("excludes Kalshi quick-settle arithmetic markets from paper scans", () => {
    const market = {
      ...demoMarkets[0],
      id: "KXQUICKSETTLE-06JUN26H2130-3",
      ticker: "KXQUICKSETTLE-06JUN26H2130-3",
      eventTicker: "KXQUICKSETTLE-06JUN26H2130",
      title: "1+1 = 3",
      ruleSummary: "If 1+1 equals 3 at the scheduled time, the market resolves to Yes.",
      closeTime: "2026-06-07T01:30:00Z",
      yesBid: 30,
      yesAsk: 70,
      noBid: 30,
      noAsk: 70,
      liquidity: 400,
      volume: 0,
      openInterest: 0
    };

    expect(isExcludedTradingUniverseMarket(market)).toBe(true);
    expect(isPaperScanCandidate(market, 300_000, Date.parse("2026-06-07T01:22:00Z"))).toBe(false);
  });

  it("keeps legitimate short-horizon markets eligible when the book is usable", () => {
    const market = {
      ...demoMarkets[0],
      ticker: "KXMLBTOTAL-26JUN061610ATHHOU-17",
      eventTicker: "KXMLBTOTAL-26JUN061610ATHHOU",
      title: "Houston vs Athletics total over 17?",
      ruleSummary: "If the professional baseball game total is over 17, then the market resolves to Yes.",
      closeTime: "2026-06-07T01:30:00Z",
      yesBid: 31,
      yesAsk: 35,
      noBid: 65,
      noAsk: 69,
      liquidity: 100
    };

    expect(isExcludedTradingUniverseMarket(market)).toBe(false);
    expect(isPaperScanCandidate(market, 300_000, Date.parse("2026-06-07T01:22:00Z"))).toBe(true);
  });

  it("selects a diversified universe across pod themes before filling by rank", () => {
    const markets = [
      market("KXMLBHIT-1", "Player A: 1+ hits?", 1000),
      market("KXMLBHIT-2", "Player B: 1+ hits?", 900),
      market("KXMLBHIT-3", "Player C: 1+ hits?", 800),
      market("KXMLBTOTAL-1", "Will the baseball total be over 7?", 50),
      market("KXFED-1", "Will the Fed cut rates?", 40)
    ];

    const selected = selectDiverseMarketUniverse(markets, { limit: 3, minPerPod: 1 });
    const pods = new Set(selected.map(classifyTradingUniversePod));

    expect(selected).toHaveLength(3);
    expect(pods).toContain("sports: player props");
    expect(pods).toContain("sports: baseball totals");
    expect(pods).toContain("macro: rates inflation");
  });

  it("does not classify player names containing fed as macro", () => {
    const tennis = market(
      "KXITFMATCH-26JUN07DIFPIS-PIS",
      "Will Giorgio Pistoia win the Di Federico vs Pistoia: M15 Messina Round of 32 match?",
      1095
    );

    expect(classifyTradingUniversePod(tennis)).toBe("sports: general");
  });

  it("folds raw crypto markets into the digital assets pod", () => {
    const row = {
      ...market("KXBTC15M-26JUN062230-30", "BTC price up in next 15 mins?", 64000),
      sector: "crypto"
    };

    expect(classifyTradingUniversePod(row)).toBe("crypto: digital assets");
  });
});

function market(ticker: string, title: string, liquidity: number) {
  return {
    ...demoMarkets[0],
    id: ticker,
    ticker,
    title,
    category: "Uncategorized",
    sector: /\bfed\b/i.test(title) ? "macro" : "sports",
    liquidity,
    yesBid: 45,
    yesAsk: 50,
    noBid: 50,
    noAsk: 55,
    closeTime: "2026-06-10T01:10:00Z"
  };
}
