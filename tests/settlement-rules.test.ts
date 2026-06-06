import { describe, expect, it } from "vitest";
import { inferSettledOutcome } from "@/lib/agents/settlement-rules";

describe("settlement reconciliation rules", () => {
  it("infers settled yes/no outcomes only from settled markets with terminal prices", () => {
    expect(inferSettledOutcome({ status: "settled", lastPrice: 100, yesBid: 99, yesAsk: 100 })).toBe("yes");
    expect(inferSettledOutcome({ status: "settled", lastPrice: 0, yesBid: 0, yesAsk: 1 })).toBe("no");
    expect(inferSettledOutcome({ status: "closed", lastPrice: 100, yesBid: 99, yesAsk: 100 })).toBeUndefined();
    expect(inferSettledOutcome({ status: "settled", lastPrice: 44, yesBid: 40, yesAsk: 48 })).toBeUndefined();
  });
});
