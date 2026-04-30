// /api/parse-solicitation.js
// FREE TIER. Extracts review criteria, page limits, format rules, and a
// compliance checklist from a pasted solicitation. Uses Haiku 4.5 (cheap).
// This is the lead magnet that hooks users into paid section drafting.

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// CORS for same-origin (Vercel default) + local dev. Tighten in production
// by reading the Origin header and matching against your prod domain.
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const SYSTEM_PROMPT = `You are an experienced federal grant reviewer and proposal consultant. You have reviewed proposals for NSF, NIH, NIST, DoD, DoE, and SBA SBIR programs.

When given a solicitation excerpt, you extract:
1. The agency and program name (e.g., "NSF SBIR Phase I", "NIH R01", "DoD SBIR").
2. The explicit review criteria the proposal will be scored against.
3. Page limits, formatting requirements, and font/margin rules.
4. Required sections and their order.
5. Mandatory certifications, eligibility requirements, and disqualifiers.
6. Submission deadline.
7. The award amount and project period.

You output a structured JSON object. You never invent details that are not present in the text. If a field is not stated, you set it to null and add a note in the "missing_info" field instructing the user to verify it in the official solicitation.

You are a parser, not a writer. Be exact, terse, and faithful to the source text.`;

const USER_TEMPLATE = (solicitationText) => `Parse the following solicitation excerpt and return a JSON object with the schema below.

<solicitation>
${solicitationText}
</solicitation>

Return ONLY valid JSON. No preamble, no markdown fences, no commentary. Schema:

{
  "agency": string | null,
  "program": string | null,
  "phase": string | null,
  "award_amount": string | null,
  "project_period": string | null,
  "deadline": string | null,
  "required_sections": [{"name": string, "page_limit": string | null, "description": string}],
  "review_criteria": [{"criterion": string, "weight": string | null, "description": string}],
  "formatting_rules": {"font": string | null, "margins": string | null, "spacing": string | null, "page_size": string | null, "other": string[]},
  "eligibility": string[],
  "mandatory_certifications": string[],
  "compliance_checklist": [{"item": string, "section": string, "critical": boolean}],
  "missing_info": string[]
}`;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { solicitation } = req.body || {};
    if (!solicitation || typeof solicitation !== "string") {
      return res.status(400).json({ error: "Missing 'solicitation' string in request body" });
    }
    if (solicitation.length < 100) {
      return res.status(400).json({ error: "Solicitation text too short. Paste at least the review criteria and section requirements." });
    }
    if (solicitation.length > 60000) {
      return res.status(400).json({ error: "Solicitation text too long. Paste only the relevant sections (review criteria, formatting, eligibility)." });
    }

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: USER_TEMPLATE(solicitation) }]
    });

    // Extract text from response content blocks
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Strip any accidental markdown fences
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse AI response as JSON", raw: cleaned.slice(0, 500) });
    }

    return res.status(200).json({ ok: true, data: parsed });
  } catch (err) {
    console.error("parse-solicitation error:", err);
    return res.status(500).json({ error: err?.message || "Internal error" });
  }
}
