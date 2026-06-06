import { describe, expect, it } from "vitest";
import { brierScore, calibrationBucket, computeForecast } from "@/lib/quant/scoring";
import { demoMarkets } from "@/lib/data/seeds";

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
});
