import { describe, expect, it } from "vitest";
import { canonicalKalshiPath, kalshiSigningMessage } from "@/lib/kalshi/signing";

describe("Kalshi request signing helpers", () => {
  it("signs the path from the API root without query parameters", () => {
    const path = canonicalKalshiPath("https://external-api.demo.kalshi.co/trade-api/v2", "/portfolio/orders?limit=5");
    expect(path).toBe("/trade-api/v2/portfolio/orders");
  });

  it("builds the official timestamp + method + path message", () => {
    expect(kalshiSigningMessage("1703123456789", "get", "/trade-api/v2/portfolio/balance")).toBe(
      "1703123456789GET/trade-api/v2/portfolio/balance"
    );
  });
});
