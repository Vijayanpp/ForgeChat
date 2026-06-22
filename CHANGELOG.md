# Changelog

User-visible changes in PitConnect. When updating, check this file for any
**Migration required** notes and apply the matching SQL files from
`supabase/migrations/` against your Supabase project before restarting the app.

---

## [Unreleased]

Multi-user accounts. Every install is multi-tenant: a single signup creates
a fresh account, and every row is scoped to that account. The **Members**
surface is now open to all users — invite teammates by link, manage roles,
transfer ownership.

### Changed

- **Tenancy moves from per-user to per-account.** RLS on every table now
  checks account membership via `is_account_member(account_id, min_role)`.
  `user_id` columns stay for assignment/audit but no longer enforce isolation.
- **WhatsApp config is one-per-account.** The `UNIQUE(user_id)` constraint
  is replaced by `UNIQUE(account_id)`.
- **Flow-media storage is now account-scoped.** New uploads go under
  `account-<account_id>/...` so any account member with the right role can
  edit them.
- **Webhook contact lookup pre-filters in SQL** — faster inbox delivery
  in team accounts with many contacts.
- **Role-aware UI gating.** Write actions (send, broadcast, add contact,
  new pipeline/deal) are disabled-with-tooltip for Viewer role.
- **Sidebar shows the active account name** when it differs from your own
  name (i.e. once you've joined a shared account or renamed yours).
- **Members tab is open to all users** — no longer gated.

### Fixed

- **Inbound messages now land in the shared inbox.** The webhook and
  automation/flow engines previously routed by `user_id`, so teammates'
  rules never fired. All lookups now use `account_id`.

### Added

- **Duplicate phone numbers are prevented.** A number can only be one
  contact per account. CSV import de-dupes within the file and against
  existing contacts. Existing duplicates are merged on upgrade (no data loss).
- **Configurable default deal currency.** Settings → Deals lets admins
  pick the account currency. New deals default to it.
- **Members tab in Settings.** See teammates, invite by link, change roles,
  remove members, transfer ownership.
- **Account & member management API** — role-gated endpoints backing the
  Members tab.
- **Invitation API + redeem flow** — link-only invite path with
  time-limited tokens.

### Migration required

Apply in order against your Supabase project before deploying:

- `supabase/migrations/017_account_sharing.sql`
- `supabase/migrations/018_account_member_rpcs.sql`
- `supabase/migrations/019_invitation_rpcs.sql`
- `supabase/migrations/020_account_sharing_followups.sql`
- `supabase/migrations/021_account_default_currency.sql` ← **apply before deploy**
- `supabase/migrations/022_contact_phone_dedup.sql` ← **apply before deploy**

All migrations are idempotent — safe to re-run.

---

## [0.2.2] — 2026-05-29

Flow nodes can now send media.

### Added

- **`send_media` flow node.** Send an image, video, or document from any
  point in a flow. Pick a file in the builder, it uploads to Supabase Storage,
  and Meta fetches the public URL at send time. Optional caption with
  `{{vars.X}}` interpolation; documents also take an optional filename.

### Migration required

- `supabase/migrations/016_flow_media.sql` — adds `send_media` to the
  `flow_nodes.node_type` check constraint and creates the `flow-media`
  Supabase Storage bucket.

---

## [0.2.1] — 2026-05-26

Bug-fix release.

### Fixed

- **Inbound messages no longer silently disappear** when two accounts have
  claimed the same `phone_number_id`. `POST /api/whatsapp/config` now returns
  409 when a number is already claimed. The webhook lookup distinguishes 0 rows
  from ≥2 rows. A new DB unique index prevents the bad state at the storage layer.

### Migration required

- `supabase/migrations/013_whatsapp_config_phone_number_id_unique.sql` — adds
  `UNIQUE(phone_number_id)` to `whatsapp_config`. Fails loudly if duplicate rows
  already exist (with a resolution hint).

---

## [0.2.0] — 2026-05-22

**Flows** release. Adds a no-code, branching, button-driven WhatsApp conversation
engine. Also ships a 5-theme colour picker.

### Added

- **Flows module** — branching chatbot conversations with a no-code visual builder.
  Node types: `send_message`, `send_buttons`, `send_list`, `collect_input`,
  `condition`, `set_tag`, `wait`.
- **Flow runner engine** — parses inbound webhooks, advances state machines,
  idempotent on Meta's `message_id`.
- **Flow builder UI** at `/flows` — drag-and-drop canvas, live validator,
  draft/active/archived status, run-history viewer.
- **3 starter templates** — Welcome menu, FAQ bot, Lead capture.
- **Stale-run sweep cron** at `GET /api/flows/cron`.
- **5 colour themes** — Violet (default), Emerald, Cobalt, Amber, Rose.
  Persisted to localStorage, applied before first paint.

### Changed

- Flows is now available to all users (no beta flag).
- Theme tokenization — all hard-coded `violet-*` classes replaced with
  `primary` tokens across the app.

### Security

- PII redacted from `reply_received` event payload.
- Constant-time cron-secret comparison on `/api/flows/cron`.

### Migration required

Apply in order:

1. `supabase/migrations/010_flows.sql`
2. `supabase/migrations/011_profile_beta_features.sql`
3. `supabase/migrations/012_flows_increment_counter.sql`

---

## [0.1.1] — 2026-05-19

### Added

- **Chat actions** — emoji reactions, reply-with-quote, copy-text on individual
  messages. Hover on desktop, long-press on touch. Outbound reactions and
  replies forward to WhatsApp via the Cloud API.

### Migration required

- `supabase/migrations/009_message_actions.sql` — adds `messages.reply_to_message_id`
  and the `message_reactions` table.

### Changed

- Inbound customer reactions are now written to `message_reactions` instead of
  appearing as text messages in the inbox.

---

## [0.1.0]

Initial release. Core CRM: shared inbox, contacts, pipelines, broadcasts,
automations (with cron drain for Wait steps), WhatsApp Cloud API integration,
Supabase Auth + RLS.
