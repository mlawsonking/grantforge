// /api/stripe-webhook.js
// OPTIONAL but recommended. Listens for checkout.session.completed events
// from Stripe so you have a server-side record of every paid session.
// In MVP we just log; in v2, write to a database / send an email receipt.

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Vercel needs the raw body for Stripe signature verification.
// This config tells Vercel not to parse the body for this route.
export const config = {
  api: { bodyParser: false }
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("[grantforge] paid session", {
      id: session.id,
      tier: session.metadata?.tier,
      amount: session.amount_total,
      email: session.customer_details?.email,
      utm_source: session.metadata?.utm_source || null,
      client_reference_id: session.client_reference_id
    });
    // TODO v2: persist to DB, send confirmation email with shareable link
  }

  return res.status(200).json({ received: true });
}
