import type { ComplianceDecision, Forecast, Market, TradeThesis } from "@/lib/domain";

const privateInfoPatterns = [
  /inside information/i,
  /leaked/i,
  /confidential/i,
  /non-public/i,
  /material nonpublic/i,
  /restricted person/i,
  /manipulat/i,
  /spoof/i,
  /deceptive/i
];

export function evaluateCompliance(input: {
  market: Market;
  thesis: Pick<TradeThesis, "summary" | "evidence">;
  forecast: Forecast;
}): ComplianceDecision {
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const text = [input.market.title, input.market.ruleSummary, input.thesis.summary, ...input.thesis.evidence.map((item) => item.excerpt)].join(" ");
  const evidenceQuality =
    input.thesis.evidence.reduce((sum, item) => sum + item.credibilityScore, 0) / Math.max(1, input.thesis.evidence.length);
  const hasPublicSettlementSource = Boolean(input.market.settlementSource && input.market.settlementSource.length > 8);
  const ruleAmbiguity = input.market.ruleSummary.length < 40 ? 0.55 : input.market.sector === "politics" ? 0.38 : 0.2;

  if (privateInfoPatterns.some((pattern) => pattern.test(text))) {
    blockedReasons.push("Potential reliance on private, leaked, confidential, manipulative, or restricted-person information.");
  }
  if (!hasPublicSettlementSource) {
    blockedReasons.push("Missing public settlement source.");
  }
  if (evidenceQuality < 0.55) {
    blockedReasons.push(`Evidence quality ${evidenceQuality.toFixed(2)} is below compliance minimum.`);
  }
  if (ruleAmbiguity > 0.35) {
    blockedReasons.push(`Rule ambiguity ${ruleAmbiguity.toFixed(2)} exceeds threshold.`);
  }
  if (input.forecast.confidence > 0.9 && input.thesis.evidence.length < 2) {
    warnings.push("High-confidence claim has limited evidence support.");
  }

  return {
    approved: blockedReasons.length === 0,
    policyVersion: "eventfund-compliance-2026-06-06",
    humanApprovalRequired: true,
    blockedReasons,
    warnings
  };
}
