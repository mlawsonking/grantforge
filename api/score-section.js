// /api/score-section.js
// PAID TIER. Takes a draft section + the parsed review criteria and returns
// a hostile reviewer scorecard with criterion-by-criterion scores (1-9 NIH
// scale or 1-5 NSF scale, agency-aware), specific weaknesses, and concrete
// revision recommendations. THIS IS THE MOAT.

import Anthropic from "@anthropic-ai/sdk";
import Stripe from "stripe";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const SYSTEM_PROMPT = `You are a hostile, experienced federal grant reviewer. You have served on NSF, NIH, NIST, and DoD review panels. You have triaged hundreds of proposals. You are tired, you have a stack of 15 proposals to review this weekend, and you are looking for reasons to mark something down.

You score each review criterion on the agency's standard scale:
- NIH: 1 (exceptional) to 9 (poor), where 1-3 = fundable, 4-6 = borderline, 7-9 = triaged
- NSF: 1 (poor) to 5 (excellent)
- DoD SBIR: 1 (poor) to 5 (excellent), with explicit pass/fail on technical feasibility
- Default if agency not specified: 1 (poor) to 5 (excellent)

You are SPECIFIC about weaknesses. You quote actual phrases from the draft when criticizing them. You name the missing element (e.g., "no preliminary data," "no power calculation," "vague commercialization plan with no named first customer," "literature review cites only the PI's own work"). You distinguish FATAL flaws (will get triaged) from MAJOR concerns (will lower score) from MINOR issues (cosmetic).

You then give CONCRETE revision recommendations — not "strengthen the approach" but "add a specific power calculation showing N=24 detects effect size d=0.8 with 80% power" or "name two letters of support targets in the commercialization plan."

You output structured JSON. You never give a generic A+ assessment. Every section has weaknesses; your job is to find them. If a draft is genuinely strong, say so on the strong criterion and find the next-weakest.`;

function buildUserPrompt({ section, draft, parsedSolicitation }) {
  const agency = parsedSolicitation?.agency || "Unknown";
  const program = parsedSolicitation?.program || "";
  const criteria = parsedSolicitation?.review_criteria
    ? JSON.stringify(parsedSolicitation.review_criteria, null, 2)
    : "Use standard review criteria for this section type.";

  return `Score the following draft of the **${section}** section for a ${agency} ${program} proposal.

Review criteria from the solicitation:
${criteria}

<draft>
${draft}
</draft>

Return ONLY valid JSON. No markdown, no preamble. Schema:

{
  "agency": string,
  "section": string,
  "scoring_scale": "1-9 (NIH, lower=better)" | "1-5 (NSF/DoD, higher=better)",
  "overall_score": number,
  "overall_verdict": "fundable" | "borderline" | "triaged" | "needs major revision",
  "criterion_scores": [
    {
      "criterion": string,
      "score": number,
      "rationale": string,
      "quoted_evidence": string
    }
  ],
  "fatal_flaws": [
    { "issue": string, "location": string, "fix": string }
  ],
  "major_concerns": [
    { "issue": string, "location": string, "fix": string }
  ],
  "minor_issues": [
    { "issue": string, "fix": string }
  ],
  "strengths": string[],
  "top_3_revisions": [
    { "priority": number, "action": string, "expected_score_lift": string }
  ]
}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sessionId, section, draft, parsedSolicitation } = req.body || {};
    if (!sessionId) return res.status(401).json({ error: "Missing sessionId" });
    if (!section || !draft) return res.status(400).json({ error: "Missing section or draft" });

    // Verify payment
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(402).json({ error: "Payment not completed" });
    }

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt({ section, draft, parsedSolicitation }) }]
    });

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

    let scorecard;
    try {
      scorecard = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse scorecard JSON", raw: cleaned.slice(0, 500) });
    }

    return res.status(200).json({ ok: true, scorecard, usage: message.usage });
  } catch (err) {
    console.error("score-section error:", err);
    return res.status(500).json({ error: err?.message || "Internal error" });
  }
}
