# GrantForge

AI-powered SBIR/grant proposal drafter with reviewer-simulation scorecard.

## What it does
1. User pastes a solicitation (NSF, NIH, DoD, NIST SBIR, etc.) + their project description.
2. Free tier: parses the solicitation and shows review criteria + compliance checklist.
3. Paid tier: generates section drafts (Specific Aims / Significance / Innovation / Approach / Commercialization) AND scores each draft against the actual review criteria as a hostile reviewer would.

## Why this is a product, not a prompt
The moat is the **reviewer simulation**. Anyone can prompt ChatGPT to write a grant section. Nobody else takes that draft and scores it 1-9 against the agency's specific review criteria with concrete weakness flags. That's what professional grant writers charge $200/hr for.

## Stack
- Frontend: static HTML/CSS/JS (no framework), 2 routes (organic + paid-traffic variant)
- Backend: 4 Vercel serverless functions (Node.js, `/api/` directory pattern)
- AI: Anthropic Claude (Haiku 4.5 for free tier, Opus 4.7 for paid drafts/scoring)
- Payments: Stripe Payment Links with `client_reference_id` + `{CHECKOUT_SESSION_ID}` redirect
- Hosting: Vercel
- Domain: Namecheap

## File layout
```
grantforge/
├── api/
│   ├── parse-solicitation.js   # Free tier: extract criteria from solicitation
│   ├── draft-section.js        # Paid: generate section draft
│   ├── score-section.js        # Paid: reviewer simulation
│   ├── verify-payment.js       # Stripe checkout session verification
│   └── stripe-webhook.js       # Optional: webhook for fulfillment record
├── public/
│   ├── index.html              # Organic landing page (full content, social proof)
│   ├── app.js                  # Shared client-side logic
│   ├── styles.css              # Shared styles
│   └── d/
│       └── index.html          # Paid-traffic landing page (single CTA, urgency)
├── package.json
├── vercel.json
├── .env.example
└── DEPLOY_GUIDE.md             # Step-by-step deployment + monetization guide
```

## Pricing
- Free: solicitation parse + compliance checklist
- $49: single section (draft + score + revisions)
- $149: full pack (5 sections, all scored)
- $299/mo: unlimited (later — start with one-time)
