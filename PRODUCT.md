# AgentForge — Product Documentation

**AgentForge** is a WhatsApp Business CRM. It connects to the official Meta WhatsApp Cloud API and gives your team a unified workspace to manage every customer conversation, contact, and sales opportunity — all from WhatsApp.

---

## Core Modules

### Shared Inbox

The inbox is the heart of AgentForge. Every incoming WhatsApp message from your business number lands here in real time.

- **Conversation list** — sorted by latest activity, unread count badges, search
- **Assignment** — assign any conversation to a specific team member
- **Status** — mark conversations as Open, Pending, or Resolved
- **Internal notes** — leave private notes visible only to your team
- **Message reactions** — react to messages with WhatsApp emoji reactions
- **Media support** — send and receive images, documents, audio, and video
- **Multi-agent** — multiple team members can work the inbox simultaneously; each sees who is handling what

---

### Contacts

A full contact management system synced with your WhatsApp conversations.

- **Contact profiles** — name, phone, email, company, location, avatar
- **Tags** — label contacts with custom tags for segmentation
- **Custom fields** — add your own fields (text, number, date, select) to capture any data your business needs
- **CSV import** — bulk import contacts from a spreadsheet
- **Deduplication** — automatic detection and merging of duplicate phone numbers
- **Conversation history** — every message thread is linked to the contact profile

---

### Sales Pipelines (Kanban)

Turn conversations into sales with visual deal tracking.

- **Multiple pipelines** — create pipelines for different products, services, or teams
- **Stages** — define your own deal stages (e.g. Lead → Qualified → Proposal → Won)
- **Deal cards** — drag and drop deals between stages
- **Deal linking** — attach a deal directly to a WhatsApp conversation and contact
- **Deal value** — track deal amounts with multi-currency support
- **Notes and activity** — log activities and notes per deal

---

### Broadcasts

Send WhatsApp messages at scale using Meta-approved message templates.

- **Template management** — create, submit, and track approval of WhatsApp message templates directly in AgentForge
- **Broadcast wizard** — 4-step wizard: pick template → select audience → configure variables → schedule or send
- **Audience targeting** — send to all contacts or filter by tag
- **Variable substitution** — personalise each message with per-recipient dynamic values (name, order number, etc.)
- **Delivery tracking** — real-time sent / delivered / read counts per broadcast
- **Dry-run mode** — test the full broadcast UI without making real Meta API calls

---

### No-code Automations

Build automated workflows that respond to WhatsApp events without writing code.

**Triggers**
- Inbound message received
- New contact created
- Keyword matched in message
- Scheduled time (cron)

**Actions**
- Send a WhatsApp message (template or free-form)
- Add or remove a tag on a contact
- Assign a conversation
- Wait a set duration (minutes, hours, days)
- Call an external webhook (HTTP POST)
- Branch on condition (contact field, tag, message content)

**Builder** — visual drag-and-drop node canvas to wire triggers → conditions → actions in any order.

**Execution logs** — every automation run is logged with step-by-step status so you can debug what happened.

---

### Visual Flows

A more powerful flow builder for complex, multi-step conversation journeys.

- **Node-based editor** — drag, connect, and configure nodes on an infinite canvas
- **Flow templates** — start from a built-in template or blank canvas
- **Activation** — flows are toggled on/off without deleting them
- **Run history** — every flow execution is recorded with status per step
- **Media nodes** — send images, documents, and audio as part of a flow

---

### Dashboard

Real-time metrics for your WhatsApp operations.

- Total conversations, open vs resolved
- Average first response time
- Daily/weekly message volume chart
- Pipeline value by stage
- Broadcast performance summary
- Cross-module activity feed (who did what, when)

---

### Team & Roles

Invite your whole team and control what each person can do.

| Role | Permissions |
|---|---|
| **Owner** | Full access including billing, settings, ownership transfer |
| **Admin** | Full access except ownership transfer |
| **Agent** | Inbox, contacts, pipelines, broadcasts — no settings |
| **Viewer** | Read-only access to all modules |

- **Invite by link** — generate a time-limited invite link to send via any channel
- **Email invite** — invite teammates directly by email address
- **Ownership transfer** — hand over the account to another member
- **Member management** — change roles or remove members at any time

---

### Settings

- **Profile** — name, avatar, email, password
- **WhatsApp** — connect your Meta App credentials (Phone Number ID, WABA ID, access token, webhook verify token)
- **Webhook** — copy your webhook callback URL for Meta configuration
- **Templates** — manage and submit WhatsApp message templates
- **Tags** — create and manage contact tags
- **Pipelines** — configure pipeline stages and deal settings
- **Members** — team management (see above)
- **Appearance** — light / dark mode, colour theme selector

---

## Security

- **Token encryption** — WhatsApp access tokens are encrypted at rest with AES-256-GCM before being stored in the database
- **HMAC webhook verification** — every inbound Meta webhook POST is verified with HMAC-SHA256 using your `META_APP_SECRET`
- **Row-Level Security** — every database table enforces account-scoped RLS so no user can read another account's data
- **Security headers** — HSTS, X-Frame-Options, CSP (report-only), Permissions-Policy
- **Rate limiting** — API routes are rate-limited to prevent abuse

---

## Technical Architecture

```
Browser (React 19 + Next.js App Router)
        │
        ▼
Next.js Server (Node.js 22)
  ├── /api/whatsapp/webhook  ← Meta sends events here
  ├── /api/whatsapp/*        ← Send messages, manage templates
  ├── /api/automations/*     ← Automation engine + cron
  ├── /api/flows/*           ← Flow engine + cron
  └── /api/account/*         ← Team management
        │
        ▼
Supabase (Postgres + Auth + Realtime + Storage)
  ├── Auth                   ← User sessions
  ├── Realtime               ← Live inbox updates
  ├── Storage                ← Media files, avatars
  └── Postgres (RLS)         ← All application data
        │
        ▼
Meta WhatsApp Cloud API      ← Send / receive WhatsApp messages
```

---

*AgentForge — MIT License.*
