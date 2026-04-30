// /api/verify-payment.js
// Lightweight endpoint the client calls after Stripe redirect, to confirm
// the checkout session is paid and to learn the tier (single vs pack).
// Does NOT consume API credit — just reads Stripe.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const sessionId = req.query?.session_id || req.body?.sessionId;
    if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return res.status(200).json({
      ok: true,
      paid: session.payment_status === "paid",
      tier: session.metadata?.tier || "single",
      amount_total: session.amount_total,
      customer_email: session.customer_details?.email || null
    });
  } catch (err) {
    console.error("verify-payment error:", err);
    return res.status(500).json({ error: err?.message || "Internal error" });
  }
}
