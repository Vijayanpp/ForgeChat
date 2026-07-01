"use client";

import { useEffect } from "react";

const BASE_TITLE = "AgentForge";

/**
 * Keeps the browser tab title in sync with the total unread count.
 * Shows "(N) AgentForge" when there are unread conversations, and
 * restores the plain title when all are read.
 *
 * Accepts `unread` as a parameter so it can be co-located with the
 * caller that already holds the count (Sidebar), avoiding a duplicate
 * Supabase Realtime subscription.
 */
export function useNotificationTitle(unread: number) {
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [unread]);
}
