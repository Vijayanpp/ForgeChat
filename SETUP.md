# AgentForge — Setup Guide

This guide walks you through everything needed to run AgentForge locally for development and deploy it to production.

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Node.js | 20.9+ | Use [nvm](https://github.com/coreybutler/nvm-windows) to manage versions. `nvm use 22` recommended. |
| npm | 10+ | Ships with Node 22 |
| Supabase account | — | Free tier is sufficient. [supabase.com](https://supabase.com) |
| Meta Developer account | — | [developers.facebook.com](https://developers.facebook.com) |
| WhatsApp Business number | — | Can start with Meta's sandbox test number |

---

## 1. Clone and install

```bash
git clone <your-repo-url>
cd agentforge
npm install
```

---

## 2. Supabase setup

### 2a. Create a project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a name, password, and region
3. Wait for the project to finish provisioning (~1–2 minutes)

### 2b. Get your API keys

In your Supabase project → **Settings → API**:

| Key | Where to find it |
|---|---|
| Project URL | `https://xxxx.supabase.co` |
| `anon` public key | Under "Project API keys" → `anon` |
| `service_role` secret key | Under "Project API keys" → `service_role` ⚠️ keep secret |

### 2c. Run the database migrations

1. Go to your project → **SQL Editor → New query**
2. Open `supabase/all_migrations.sql` from this repo
3. Select all (`Ctrl+A`), paste into the SQL editor
4. Click **Run**

This creates all 22 tables, RLS policies, functions, and indexes in the correct order.

> If you see any errors about existing tables, the migrations are idempotent — re-running is safe.

---

## 3. Meta / WhatsApp setup

### 3a. Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**
2. Select **Business** as the app type
3. Fill in the app name and contact email

### 3b. Add the WhatsApp product

1. In your app dashboard → **Add Product**
2. Find **WhatsApp** → click **Set Up**
3. Connect your Facebook Business account when prompted

### 3c. Get your credentials

In **WhatsApp → API Setup**:

| Credential | Where to find it |
|---|---|
| Phone Number ID | Shown on the API Setup page (numeric ID, not the phone number itself) |
| WhatsApp Business Account ID (WABA ID) | Shown on the API Setup page |
| Temporary Access Token | Click **Generate access token** (expires in 24h — see below for permanent token) |

**To generate a permanent access token** (recommended for production):
1. Go to **Business Settings → System Users**
2. Create a System User with Admin role
3. Assign your app and WhatsApp assets to the user
4. Generate a **Never Expiring** token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions

### 3d. Get your App Secret

In your app → **App Settings → Basic** → copy the **App Secret** value.

---

## 4. Environment variables

Copy the example file:

```bash
cp .env.local.example .env.local    # Windows: copy .env.local.example .env.local
```

Open `.env.local` and fill in:

```env
# ── REQUIRED ──────────────────────────────────────────────────────────

# From Supabase project → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your-64-char-hex-key

# From Meta App → App Settings → Basic → App Secret
META_APP_SECRET=your-meta-app-secret

# ── RECOMMENDED ───────────────────────────────────────────────────────

# Your public URL (required for invite links from cron jobs)
NEXT_PUBLIC_SITE_URL=https://your-domain.com

# ── OPTIONAL ──────────────────────────────────────────────────────────

# Set "true" to skip real Meta API calls when testing template UI
# WHATSAPP_TEMPLATES_DRY_RUN=true

# Protects GET /api/automations/cron — set any long random string
# AUTOMATION_CRON_SECRET=generate-a-long-random-string

# ── SMART AI AGENTS (LangGraph) — all optional ───────────────────────
# Kill switch: "false" makes smart agents skip every turn (simple agents unaffected)
# AI_AGENTS_LANGGRAPH_ENABLED=true
# Wait this long after the last customer message before replying (batches bursts)
# AI_AGENT_DEBOUNCE_MS=4000
# Agent stays silent for this many minutes after a human teammate replies
# AI_AGENT_HUMAN_COOLDOWN_MIN=30
# Per-account monthly token cap for smart agents (0 = unlimited)
# AI_AGENT_MONTHLY_TOKEN_BUDGET=0
# Cheap model used for classification, extraction and reply rewrites
# AI_AGENT_CONTROL_MODEL=gpt-4o-mini
# Model used when a customer sends a photo (palm reading)
# AI_AGENT_VISION_MODEL=gpt-4o
# AI_AGENT_TURN_TIMEOUT_MS=25000
# AI_AGENT_MAX_ATTEMPTS=3
# "inline" (default) runs jobs in-process; "cron" relies only on the worker endpoint
# AI_AGENT_DISPATCH=inline
# Protects GET /api/ai-agents/worker (header x-cron-secret)
# AI_AGENT_CRON_SECRET=generate-a-long-random-string

# Paid palm reports (palm-reading agent with "Paid detailed report" on).
# Reports are emailed through Resend (https://resend.com) from your own domain.
# RESEND_API_KEY=re_...
# Default sender if the agent doesn't set one; the domain must be verified in Resend
# REPORT_EMAIL_FROM=AskMyPalm <reports@yourdomain.com>

# LangSmith tracing (inputs/outputs are redacted). Do NOT set LANGSMITH_TRACING —
# that attaches an un-redacted global tracer.
# AI_AGENT_LANGSMITH_TRACING=true
# AI_AGENT_TRACE_SAMPLE_RATE=1
# LANGSMITH_API_KEY=lsv2_...
# LANGSMITH_PROJECT=ForgeChat Agents
# LANGSMITH_ENDPOINT=https://api.smith.langchain.com
```

To generate a fresh `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on the login page.

**Sign up** to create your first owner account.

---

## 6. Connect your WhatsApp number

1. In the app → **Settings → WhatsApp**
2. Fill in:
   - **Phone Number ID** — from Meta API Setup page
   - **WABA ID** — from Meta API Setup page
   - **Permanent Access Token** — from Meta
   - **Webhook Verify Token** — any string you invent (e.g. `agentforge_webhook_2024`)
   - **Two-step verification PIN** — 6-digit PIN set in Meta Business Manager → Phone Numbers → Two-step verification (leave blank for Meta test numbers)
3. Click **Save Configuration**

---

## 7. Configure the Meta webhook

Meta needs a publicly accessible URL to send WhatsApp events to. In local development, use a tunnel.

### Option A — ngrok (recommended, stable URL per session)

```bash
# Install ngrok authtoken once
npx ngrok config add-authtoken <your-ngrok-token>

# Start the tunnel
npx ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL.

### Option B — localtunnel (no account needed, URL changes on restart)

```bash
npx localtunnel --port 3000
```

### Configure the webhook in Meta

1. In your Meta app → **WhatsApp → Configuration → Webhooks → Edit**
2. **Callback URL**: `https://your-tunnel-url/api/whatsapp/webhook`
3. **Verify Token**: the same string you set in AgentForge Settings
4. Click **Verify and Save**
5. Under **Webhook Fields**, subscribe to **`messages`**

Update `.env.local`:

```env
NEXT_PUBLIC_SITE_URL=https://your-tunnel-url
```

---

## 8. Cron jobs (optional — for automations with Wait steps)

If you use **Wait** steps in automations or time-based flow triggers, you need an external scheduler to call:

```
GET /api/automations/cron?secret=<AUTOMATION_CRON_SECRET>
GET /api/flows/cron?secret=<AUTOMATION_CRON_SECRET>
```

Every 1–5 minutes is recommended. Options:
- [cron-job.org](https://cron-job.org) (free)
- Supabase Edge Functions with a pg_cron trigger
- Any server cron / GitHub Actions schedule

Set `AUTOMATION_CRON_SECRET` in `.env.local` to protect the endpoint.

### Smart AI agent worker

Smart agents (engine "Smart agent" in **AI Agents**) reply through a durable job queue. On a single long-running Node server jobs are processed in-process automatically. On serverless hosting, multiple instances, or with `AI_AGENT_DISPATCH=cron`, also call this every minute so no reply is stranded after a restart:

```
GET /api/ai-agents/worker      (header: x-cron-secret: <AI_AGENT_CRON_SECRET>)
```

Smart agents only run from an automation's **AI Reply** step — pick a smart agent there. Apply migration `032_ai_agent_runtime.sql` first.

### Paid palm reports

A palm-reading agent with **Paid detailed report** switched on gives the free readings, sends your payment link, checks the customer's payment screenshot, collects birth details and emails a full HTML report (plus a private link on WhatsApp).

1. Apply migration `033_ai_agent_paid_reports.sql`.
2. In [Resend](https://resend.com), add and verify your domain (it gives you SPF/DKIM DNS records), create an API key, and set `RESEND_API_KEY` and `REPORT_EMAIL_FROM`.
3. `NEXT_PUBLIC_SITE_URL` must be your public URL — report links are `<site>/r/<token>`.
4. In the agent: set the price, payment link (e.g. `razorpay.me/@yourhandle`) and the payee name(s) customers see on their UPI receipts. Optionally add Razorpay API keys (edit page) so `pay_…` IDs are confirmed with Razorpay.
5. Screenshots the bot can't verify wait in **AI Agents → Payments & reports** for you to approve or reject.

Reports take 1–2 minutes to write. They are generated in-process on a long-running server; on serverless hosting or with `AI_AGENT_DISPATCH=cron`, also call every minute:

```
GET /api/ai-agents/reports/worker   (header: x-cron-secret: <AI_AGENT_CRON_SECRET>, up to 5 min)
```

---

## Production deployment

### Deploy to Hostinger (Node.js hosting)

1. Push your code to a GitHub repository
2. In [hPanel](https://hpanel.hostinger.com) → **Websites → Create** → pick **Node.js**
3. Connect your GitHub repository
4. Add all environment variables from `.env.local` into hPanel's env var section
5. Push to `main` — Hostinger builds and serves automatically

### Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Add all environment variables in the Vercel dashboard → your project → **Settings → Environment Variables**.

### Deploy to any VPS / Docker host

```bash
npm run build
npm start         # starts on port 3000 by default
```

Set `PORT` environment variable to change the port. Use nginx or Caddy as a reverse proxy for SSL.

---

## Useful commands

```bash
npm run dev           # Start development server (hot reload)
npm run build         # Production build
npm run start         # Serve production build
npm run typecheck     # TypeScript check (no emit)
npm run lint          # ESLint
npm run format        # Prettier auto-format
npm test              # Run unit tests (Vitest)
```

---

## Troubleshooting

### App won't start — "Cannot find native binding"

Run a clean reinstall under Node 20+:

```bash
Remove-Item -Recurse -Force node_modules, package-lock.json, .next
npm install
npm run dev
```

### WhatsApp webhook verification fails

- Check that the **Verify Token** in AgentForge Settings matches exactly what you entered in Meta
- Check that your tunnel URL is active and publicly reachable
- Check `META_APP_SECRET` is set correctly in `.env.local`

### "Not registered — Meta will not deliver events"

Your credentials are valid but the phone number isn't subscribed to your app. In Settings → WhatsApp:

1. Enter the 6-digit two-step verification PIN
2. Click **Save Configuration**
3. Click **Verify with Meta** to confirm

### Messages not arriving in inbox

1. Confirm webhook is verified in Meta (**WhatsApp → Configuration** shows green tick)
2. Confirm the `messages` webhook field is subscribed
3. Click **Verify with Meta** in Settings → WhatsApp to check registration status
4. Check your tunnel is still running (localtunnel drops; restart if needed)

### Token decryption error after moving environments

`ENCRYPTION_KEY` must be identical across all environments. If you change it, all saved WhatsApp tokens become unreadable — click **Reset Configuration** in Settings → WhatsApp and re-enter your credentials.

---

*AgentForge — MIT License.*
