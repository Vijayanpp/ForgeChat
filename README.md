# AgentForge — WhatsApp Business CRM

> The all-in-one WhatsApp Business CRM for your team — shared inbox,
> contacts, pipelines, broadcasts, and no-code automations.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## What you get

- **Shared inbox** — Multiple agents on one WhatsApp number. Assign conversations, set statuses, leave internal notes.
- **Contacts** — Tags, custom fields, CSV import, automatic deduplication.
- **Sales pipelines** — Kanban board with deals linked directly to conversations.
- **Broadcasts** — Send Meta-approved templates to contact lists with per-recipient variable substitution and delivery tracking.
- **No-code automations** — Trigger on inbound messages, new contacts, keywords, or schedule. Branches, waits, tags, webhooks. Visual builder.
- **Visual flows** — Drag-and-drop flow editor for complex conversation journeys.
- **Real-time dashboard** — Response times, daily volume, pipeline value, activity feed.
- **Team accounts** — Invite teammates by link, role-based access (owner / admin / agent / viewer), ownership transfer.

## Quick start (development)

See the full guide → **[SETUP.md](./SETUP.md)**

```bash
git clone <your-repo-url>
cd agentforge
npm install
cp .env.local.example .env.local   # fill in credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui |
| Database | Supabase (Postgres + Auth + Storage + RLS) |
| WhatsApp | Meta Cloud API (WhatsApp Business) |
| Flow editor | React Flow (@xyflow/react) |
| Charts | Recharts |

## Documentation

| Document | Description |
|---|---|
| [SETUP.md](./SETUP.md) | Complete setup and deployment guide |
| [PRODUCT.md](./PRODUCT.md) | Full product feature documentation |
| [.env.local.example](./.env.local.example) | All environment variable reference |

## License

[MIT](./LICENSE)
