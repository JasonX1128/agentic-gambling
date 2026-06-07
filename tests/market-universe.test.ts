import { describe, expect, it } from "vitest";
import { isExcludedTradingUniverseMarket, isPaperScanCandidate } from "@/lib/markets/universe";
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
});
