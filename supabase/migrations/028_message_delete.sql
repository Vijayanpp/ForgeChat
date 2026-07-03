-- ============================================================
-- 028_message_delete
--
-- Splits the `messages_modify` FOR ALL policy (017_account_sharing.sql)
-- into per-command policies so DELETE can require a higher role than
-- INSERT/UPDATE:
--
--   - messages_insert / messages_update: agent+ (unchanged behavior —
--     needed by POST /api/whatsapp/send, which writes through the
--     caller's own RLS-scoped Supabase client).
--   - messages_delete: admin+ only. Backs the "Delete message" action
--     in the inbox (DELETE /api/whatsapp/messages/[id]) — a hard,
--     irreversible delete since WhatsApp's Cloud API has no
--     recall/unsend endpoint to mirror. Previously any agent could
--     delete a message directly via their own Supabase session; this
--     closes that gap so the app-layer requireRole("admin") check in
--     the API route is backed by the same rule at the DB layer.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DROP POLICY IF EXISTS messages_modify ON messages;
DROP POLICY IF EXISTS messages_insert ON messages;
DROP POLICY IF EXISTS messages_update ON messages;
DROP POLICY IF EXISTS messages_delete ON messages;

CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
);

CREATE POLICY messages_update ON messages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
);

CREATE POLICY messages_delete ON messages FOR DELETE USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'admin'))
);
