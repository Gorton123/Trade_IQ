# TradeIQ — Complete Render Deployment Guide

## What was changed from Replit (everything else is untouched)

| File | Change |
|---|---|
| `server/replit_integrations/auth/replitAuth.ts` | Replit OIDC → JWT + bcrypt |
| `server/replit_integrations/auth/storage.ts` | Added `getUserByEmail()` |
| `shared/models/auth.ts` | Added `password_hash` column |
| `client/src/pages/landing.tsx` | New login/register UI |
| `server/stripeClient.ts` | Removed Replit connector, uses env vars directly |
| `server/routes.ts` | KeepAlive now reads `RENDER_EXTERNAL_URL` |
| `server/index.ts` | Added cookie-parser |
| `package.json` | Added jwt/bcrypt/cookie-parser, removed Replit packages |
| `render.yaml` | NEW — full Render deployment blueprint |
| `migrate-auth.sql` | NEW — one-time DB migration |

---

## Step 1 — Generate VAPID keys (for push notifications)

Run this once locally (needs Node.js):
```bash
node -e "const webpush = require('web-push'); const k = webpush.generateVAPIDKeys(); console.log('PUBLIC:', k.publicKey); console.log('PRIVATE:', k.privateKey);"
```
Save both keys — you'll need them in Step 5.

---

## Step 2 — Push to GitHub

```bash
cd tradeiq-render
git init
git add .
git commit -m "TradeIQ — Render deployment ready"
git remote add origin https://github.com/YOUR_USERNAME/tradeiq.git
git push -u origin main
```

---

## Step 3 — Deploy on Render

1. Go to **render.com** → sign in with GitHub
2. Click **New** → **Blueprint**
3. Select your `tradeiq` GitHub repo
4. Render reads `render.yaml` automatically
5. It creates: **1 Web Service + 1 PostgreSQL database**
6. Click **Apply** — first build takes ~5 minutes

---

## Step 4 — Run database migration

Once the Render PostgreSQL is created:

1. Render Dashboard → `tradeiq-db` → **Connect** → copy the **External Database URL**
2. Run the migration:
```bash
psql "YOUR_EXTERNAL_DATABASE_URL" -f migrate-auth.sql
```
3. Then run Drizzle to create all app tables:
```bash
DATABASE_URL="YOUR_EXTERNAL_DATABASE_URL" npm run db:push
```

---

## Step 5 — Set environment variables

Render Dashboard → your `tradeiq` web service → **Environment** → add each:

| Variable | Where to get it |
|---|---|
| `OANDA_API_KEY` | OANDA dashboard → Manage API Access |
| `OANDA_ACCOUNT_ID` | OANDA dashboard → your account ID |
| `TWELVE_DATA_API_KEY` | twelvedata.com → API → My API Keys |
| `ALPHA_VANTAGE_API_KEY` | alphavantage.co → Get free API key |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram → /newbot |
| `STRIPE_LIVE_SECRET_KEY` | Stripe dashboard → Developers → API Keys |
| `STRIPE_LIVE_PUBLISHABLE_KEY` | Stripe dashboard → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → Webhooks → your endpoint secret |
| `VAPID_PUBLIC_KEY` | Generated in Step 1 |
| `VAPID_PRIVATE_KEY` | Generated in Step 1 |

`DATABASE_URL`, `SESSION_SECRET`, `JWT_SECRET`, `RENDER_EXTERNAL_URL` — auto-set by render.yaml.

---

## Step 6 — Set up Stripe Webhook

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**
2. URL: `https://YOUR-RENDER-URL.onrender.com/api/stripe/webhook`
3. Events to listen for: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.*`
4. Copy the webhook signing secret → set as `STRIPE_WEBHOOK_SECRET`

---

## Step 7 — First login

1. Visit `https://tradeiq.onrender.com`
2. Click **Create Account**
3. Register with your email and password
4. Complete the onboarding wizard
5. Add your OANDA credentials in Settings → your signal scanner starts automatically

---

## Costs

| Service | Plan | Cost |
|---|---|---|
| Web Service | Starter (always-on, required for 24/7 scanner) | ~£7/mo |
| PostgreSQL | Basic (persistent, no expiry) | ~£7/mo |
| **Total** | | **~£14/mo** |

This replaces Replit which was costing you significantly more per month.

---

## Ongoing updates

```bash
# Make changes locally, then:
git add .
git commit -m "Description of change"
git push
# Render auto-redeploys in ~3 minutes
```

---

## Architecture on Render

```
render.com
├── tradeiq (Web Service — Node.js)
│   ├── Signal scanner (60s loop, 96 instrument/timeframe combos)
│   ├── Auto-optimizer (4hr cycle)
│   ├── Strategy Intelligence (15min updates)
│   ├── Trade Guardian (60s safety checks)
│   ├── Micro-scalper (per-user OANDA streaming)
│   ├── Telegram bot (always listening)
│   └── Stripe webhooks
└── tradeiq-db (PostgreSQL)
    ├── signal_history
    ├── simulated_trades
    ├── auto_optimized_profiles
    ├── user_settings
    └── sessions
```
