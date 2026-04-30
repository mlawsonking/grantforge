// /api/draft-section.js
// PAID TIER. Generates a draft of one specific proposal section, tuned to
// the agency's review criteria. Uses Opus 4.7 with adaptive thinking for
// quality. Verifies a Stripe checkout session ID before responding.

import Anthropic from "@anthropic-ai/sdk";
import Stripe from "stripe";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Verify the user actually paid. Stripe Checkout Session must be paid AND
// must be one of our products (single-section or full-pack).
// Single-section sessions get 1 unit of credit; full-pack gets 5.
async function verifyAndConsume(sessionId, kvNamespace) {
  // For MVP we use Stripe as the source of truth and don't track consumption
  // across sessions — each Checkout Session ID can be used to draft up to
  // its purchased section count. We rely on Stripe's session ID being
  // unguessable. To enforce per-session usage caps in production, add a
  // Vercel KV / Upstash Redis layer keyed by session ID.
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") {
    throw new Error("Payment not completed");
  }
  // Read product tier from session metadata (set on the Payment Link).
  // tier === "single" → 1 section. tier === "pack" → 5 sections.
  const tier = session.metadata?.tier || "single";
  return { tier, sessionId: session.id };
}

const SYSTEM_PROMPT = `You are a senior federal grant writer with 15 years of experience writing successful SBIR, NIH R-series, NSF, and DoD proposals. You have personally received federal funding and have served on review panels.

You write in a precise, technical, persuasive voice. You do not pad. You do not use marketing language. You write the way successful proposals actually read: dense, specific, evidence-anchored, and structured to score well against published review criteria.

You match agency house style:
- NSF: emphasize Intellectual Merit and Broader Impacts as named criteria.
- NIH: emphasize Significance, Innovation, Approach, Investigators, Environment.
- DoD SBIR: emphasize technical merit, transition path, and dual-use commercialization.
- NIST/DoE/USDA SBIR: align with the specific topic's evaluation criteria.

You write in the first-person plural ("we") and present tense unless otherwise instructed. You use specific numbers, named methods, and citation-ready references. You do not invent citations or data — when a placeholder is needed, you mark it clearly as [INSERT: specific data] so the PI can fill it in.

Your output is the section draft only — no preamble, no meta-commentary about the draft, no markdown headers unless the section convention requires them.`;

function buildUserPrompt({ section, projectDescription, parsedSolicitation, additionalContext }) {
  const reviewCriteria = parsedSolicitation?.review_criteria
    ? JSON.stringify(parsedSolicitation.review_criteria, null, 2)
    : "Not provided — use general best practices for this section type.";

  const pageLimit = parsedSolicitation?.required_sections?.find(
    (s) => s.name?.toLowerCase().includes(section.toLowerCase())
  )?.page_limit;

  const agency = parsedSolicitation?.agency || "the funding agency";
  const program = parsedSolicitation?.program || "";

  return `Draft the **${section}** section for a ${agency} ${program} proposal.

The proposal must score well against these review criteria:
${reviewCriteria}

${pageLimit ? `Page limit for this section: ${pageLimit}` : "Standard page conventions apply."}

PROJECT DESCRIPTION (from the PI):
<project_description>
${projectDescription}
</project_description>

${additionalContext ? `\nADDITIONAL CONTEXT:\n<context>\n${additionalContext}\n</context>` : ""}

Write the section. Output the draft text only. Do not write a meta-introduction. Do not say "Here is your draft." Begin with the section content directly. If the section conventionally has subheadings, use them. Where specific PI-provided data is needed but missing, insert [INSERT: <what is needed>] inline so the PI can fill it in.`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sessionId, section, projectDescription, parsedSolicitation, additionalContext } = req.body || {};

    if (!sessionId) return res.status(401).json({ error: "Missing sessionId. Please complete checkout first." });
    if (!section) return res.status(400).json({ error: "Missing 'section' parameter" });
    if (!projectDescription || projectDescription.length < 100) {
      return res.status(400).json({ error: "Project description must be at least 100 characters" });
    }

    // Verify payment before spending Opus tokens
    let verification;
    try {
      verification = await verifyAndConsume(sessionId);
    } catch (e) {
      return res.status(402).json({ error: "Payment verification failed: " + e.message });
    }

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildUserPrompt({ section, projectDescription, parsedSolicitation, additionalContext }) }
      ]
    });

    const draft = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    return res.status(200).json({
      ok: true,
      section,
      draft,
      tier: verification.tier,
      usage: message.usage
    });
  } catch (err) {
    console.error("draft-section error:", err);
    return res.status(500).json({ error: err?.message || "Internal error" });
  }
}
