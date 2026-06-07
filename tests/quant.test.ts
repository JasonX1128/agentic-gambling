import { describe, expect, it } from "vitest";
import { brierScore, calibrationBucket, computeForecast, hoursUntilClose, resolutionUrgencyScore } from "@/lib/quant/scoring";
import { demoMarkets, estimateFairProbability } from "@/lib/data/seeds";

describe("quant scoring", () => {
  it("computes Brier score and calibration buckets", () => {
    expect(brierScore(0.7, true)).toBeCloseTo(0.09);
    expect(calibrationBucket(0.74)).toBe("0.7-0.8");
  });

  it("ranks positive EV when fair probability exceeds market probability", () => {
    const forecast = computeForecast(demoMarkets[0], 0.65);
    expect(forecast.expectedValue).toBeGreaterThan(0);
    expect(forecast.confidence).toBeGreaterThan(0.55);
  });

  it("does not treat a missing real-market last price as a zero fair probability", () => {
    const fair = estimateFairProbability(
      {
        ...demoMarkets[0],
        id: "real-zero-last",
        ticker: "KXREAL-ZERO-LAST",
        source: "kalshi",
        yesBid: 5,
        yesAsk: 7,
        noBid: 92,
        noAsk: 95,
        lastPrice: 0,
        liquidity: 80
      },
      10
    );
    expect(fair).toBeGreaterThan(0.02);
    expect(fair).toBeLessThan(0.12);
  });

  it("rewards shorter resolution horizons without chasing expired markets", () => {
    const now = new Date("2026-06-06T12:00:00.000Z");
    const sixHours = { closeTime: "2026-06-06T18:00:00.000Z" };
    const tenDays = { closeTime: "2026-06-16T12:00:00.000Z" };
    const expired = { closeTime: "2026-06-06T11:59:00.000Z" };

    expect(hoursUntilClose(sixHours, now)).toBeCloseTo(6);
    expect(resolutionUrgencyScore(sixHours, now)).toBeGreaterThan(resolutionUrgencyScore(tenDays, now));
    expect(resolutionUrgencyScore(expired, now)).toBe(0);
  });
});
