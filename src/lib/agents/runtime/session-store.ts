import type { SupabaseClient } from "@supabase/supabase-js";

import type { SessionState } from "../types";

export interface StoredSession {
  id: string | null;
  version: number;
  state: SessionState;
}

interface SessionRow {
  id: string;
  agent_id: string;
  stage: string;
  state: { slots?: Record<string, unknown>; summary?: string | null } | null;
  handed_off: boolean;
  paused_until: string | null;
  version: number;
}

export function freshSession(): SessionState {
  return { stage: "new", slots: {}, summary: null, handedOff: false, pausedUntil: null };
}

function fromRow(row: SessionRow): SessionState {
  return {
    stage: row.stage,
    slots: row.state?.slots ?? {},
    summary: row.state?.summary ?? null,
    handedOff: row.handed_off,
    pausedUntil: row.paused_until,
  };
}

interface SessionKey {
  accountId: string;
  agentId: string;
  conversationId: string;
}

/**
 * Load the conversation's session. If a different agent owned it,
 * conversation memory is reset but human-control flags survive.
 */
export async function loadSession(db: SupabaseClient, key: SessionKey): Promise<StoredSession> {
  const { data, error } = await db
    .from("ai_agent_sessions")
    .select("id, agent_id, stage, state, handed_off, paused_until, version")
    .eq("conversation_id", key.conversationId)
    .eq("account_id", key.accountId)
    .maybeSingle();
  if (error) throw new Error(`failed to load agent session: ${error.message}`);
  if (!data) return { id: null, version: 0, state: freshSession() };

  const row = data as SessionRow;
  if (row.agent_id !== key.agentId) {
    return {
      id: row.id,
      version: row.version,
      state: { ...freshSession(), handedOff: row.handed_off, pausedUntil: row.paused_until },
    };
  }
  return { id: row.id, version: row.version, state: fromRow(row) };
}

function toColumns(key: SessionKey, state: SessionState) {
  return {
    agent_id: key.agentId,
    stage: state.stage,
    state: { slots: state.slots, summary: state.summary },
    handed_off: state.handedOff,
    paused_until: state.pausedUntil,
  };
}

/**
 * Optimistic-concurrency save. On conflict (someone paused/resumed
 * the session mid-turn), their human-control flags win.
 */
export async function saveSession(
  db: SupabaseClient,
  key: SessionKey,
  stored: StoredSession,
  next: SessionState,
): Promise<void> {
  if (!stored.id) {
    const { error } = await db.from("ai_agent_sessions").insert({
      account_id: key.accountId,
      conversation_id: key.conversationId,
      ...toColumns(key, next),
    });
    if (!error) return;
    if (error.code !== "23505") throw new Error(`failed to create agent session: ${error.message}`);
    const current = await loadSession(db, key);
    return saveSession(db, key, current, { ...next, handedOff: current.state.handedOff || next.handedOff });
  }

  const { data, error } = await db
    .from("ai_agent_sessions")
    .update({ ...toColumns(key, next), version: stored.version + 1 })
    .eq("id", stored.id)
    .eq("version", stored.version)
    .select("id");
  if (error) throw new Error(`failed to save agent session: ${error.message}`);
  if (data && data.length > 0) return;

  const { data: latest, error: readErr } = await db
    .from("ai_agent_sessions")
    .select("handed_off, paused_until, version")
    .eq("id", stored.id)
    .maybeSingle();
  if (readErr || !latest) throw new Error("agent session changed concurrently and could not be reloaded");

  const merged: SessionState = {
    ...next,
    handedOff: Boolean(latest.handed_off) || next.handedOff,
    pausedUntil: (latest.paused_until as string | null) ?? null,
  };
  const { error: retryErr } = await db
    .from("ai_agent_sessions")
    .update({ ...toColumns(key, merged), version: (latest.version as number) + 1 })
    .eq("id", stored.id);
  if (retryErr) throw new Error(`failed to save agent session: ${retryErr.message}`);
}
