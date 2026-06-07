import { NextRequest, NextResponse } from "next/server";
import { getOpportunities } from "@/lib/agents/orchestrator";
import { researchOpportunityWithBrowserAgent } from "@/lib/research/browser-agent";
import { saveOpportunity } from "@/lib/redis/coordination";
import { operatorAuthResponse } from "@/lib/security/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = operatorAuthResponse(req);
  if (auth) return auth;
  const { id } = await params;
  const opportunity = (await getOpportunities()).find((item) => item.id === id);
  if (!opportunity) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  try {
    const enriched = await researchOpportunityWithBrowserAgent(opportunity);
    await saveOpportunity(enriched).catch(() => undefined);
    return NextResponse.json({
      opportunity: enriched,
      browserResearch: enriched.browserResearch
    });
  } catch (error) {
    return NextResponse.json(
      {
        blocked: true,
        code: "BROWSER_RESEARCH_FAILED",
        error: error instanceof Error ? error.message : String(error),
        remediation: [
          "Set BROWSER_RESEARCH_ENABLED=true and BROWSER_RESEARCH_ENDPOINT for public web deep dives.",
          "Set THE_ODDS_API_KEY to enable sportsbook odds comparison."
        ]
      },
      { status: 503 }
    );
  }
}
