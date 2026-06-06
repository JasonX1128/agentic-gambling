import type { Market, SettlementOutcome } from "@/lib/domain";

export function inferSettledOutcome(market: Pick<Market, "status" | "lastPrice" | "yesBid" | "yesAsk">): SettlementOutcome | undefined {
  if (market.status !== "settled") return undefined;
  if (market.lastPrice >= 99 || market.yesBid >= 99 || market.yesAsk >= 99) return "yes";
  if (market.lastPrice <= 1 || (market.yesBid <= 1 && market.yesAsk <= 1)) return "no";
  return undefined;
}
