"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { AccountRole } from "@/lib/auth/roles";

// ── types ─────────────────────────────────────────────────────────────────

interface TeamMember {
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  account_role: AccountRole;
  created_at: string;
}

interface ConvCounts {
  open: number;
  pending: number;
}

// ── role display helpers ──────────────────────────────────────────────────

const ROLE_LABEL: Record<AccountRole, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Agent",
  viewer: "Viewer",
};

const ROLE_CHIP: Record<AccountRole, string> = {
  owner: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  admin: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  agent: "bg-slate-700/60 text-slate-300 border-slate-600/40",
  viewer: "bg-slate-800/60 text-slate-500 border-slate-700/40",
};

// ── skeleton ──────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-slate-800" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-800" />
        <div className="h-3 w-48 animate-pulse rounded bg-slate-800" />
      </div>
      <div className="flex gap-2">
        <div className="h-6 w-14 animate-pulse rounded-full bg-slate-800" />
        <div className="h-6 w-14 animate-pulse rounded-full bg-slate-800" />
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { user, profile, accountId } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [convCounts, setConvCounts] = useState<Record<string, ConvCounts>>({});
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // ── data fetch ────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();

    const [membersRes, convsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, account_role, created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true }),
      supabase
        .from("conversations")
        .select("assigned_agent_id, status")
        .eq("account_id", accountId)
        .in("status", ["open", "pending"])
        .not("assigned_agent_id", "is", null),
    ]);

    if (membersRes.data) {
      setMembers(membersRes.data as TeamMember[]);
    }

    if (convsRes.data) {
      const counts: Record<string, ConvCounts> = {};
      for (const row of convsRes.data as { assigned_agent_id: string; status: string }[]) {
        const id = row.assigned_agent_id;
        if (!counts[id]) counts[id] = { open: 0, pending: 0 };
        if (row.status === "open") counts[id].open += 1;
        else if (row.status === "pending") counts[id].pending += 1;
      }
      setConvCounts(counts);
    }

    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── presence ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!accountId || !user?.id) return;

    const supabase = createClient();
    const channel = supabase.channel(`presence:team:${accountId}`, {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ userId: string }>();
        const ids = new Set(
          Object.values(state)
            .flat()
            .map((p) => p.userId)
            .filter(Boolean),
        );
        setOnlineIds(ids);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            userId: user.id,
            name: profile?.full_name ?? "",
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, user?.id, profile?.full_name]);

  // ── render ────────────────────────────────────────────────────────────

  const totalOpen = Object.values(convCounts).reduce((s, c) => s + c.open, 0);
  const totalPending = Object.values(convCounts).reduce((s, c) => s + c.pending, 0);
  const onlineCount = members.filter((m) => onlineIds.has(m.user_id)).length;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Team</h1>
          <p className="mt-1 text-sm text-slate-400">
            Agent workload and online status across your workspace
          </p>
        </div>
        {!loading && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span>
              <span className="font-medium text-white">{members.length}</span>{" "}
              member{members.length !== 1 ? "s" : ""}
            </span>
            <span className="text-slate-700">·</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              {onlineCount} online
            </span>
          </div>
        )}
      </div>

      {/* Summary stat row */}
      {!loading && (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-3">
          <StatTile label="Team members" value={members.length} />
          <StatTile label="Open conversations" value={totalOpen} accent="blue" />
          <StatTile label="Pending conversations" value={totalPending} accent="amber" />
        </div>
      )}

      {/* Member cards */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
        ) : members.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">No team members found.</p>
        ) : (
          members.map((member) => {
            const counts = convCounts[member.user_id] ?? { open: 0, pending: 0 };
            const isOnline = onlineIds.has(member.user_id);
            const isMe = member.user_id === user?.id;
            const initials = (member.full_name ?? "?")
              .split(" ")
              .map((p) => p[0])
              .join("")
              .toUpperCase()
              .slice(0, 2);

            return (
              <div
                key={member.user_id}
                className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5"
              >
                {/* Avatar + online dot */}
                <div className="relative shrink-0">
                  {member.avatar_url ? (
                    <img
                      src={member.avatar_url}
                      alt={member.full_name}
                      className="h-11 w-11 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white">
                      {initials}
                    </div>
                  )}
                  <span
                    className={cn(
                      "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-900",
                      isOnline ? "bg-emerald-500" : "bg-slate-600",
                    )}
                    title={isOnline ? "Online" : "Offline"}
                  />
                </div>

                {/* Name + email + role */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">
                      {member.full_name}
                    </span>
                    {isMe && (
                      <span className="shrink-0 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                        You
                      </span>
                    )}
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                        ROLE_CHIP[member.account_role],
                      )}
                    >
                      {ROLE_LABEL[member.account_role]}
                    </span>
                  </div>
                  {member.email && (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{member.email}</p>
                  )}
                </div>

                {/* Conversation load */}
                <div className="flex shrink-0 items-center gap-2">
                  {counts.open === 0 && counts.pending === 0 ? (
                    <span className="text-xs text-slate-600">No assigned convs</span>
                  ) : (
                    <>
                      {counts.open > 0 && (
                        <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-medium text-blue-400 border border-blue-500/20">
                          {counts.open} open
                        </span>
                      )}
                      {counts.pending > 0 && (
                        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-400 border border-amber-500/20">
                          {counts.pending} pending
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── stat tile ─────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "blue" | "amber";
}) {
  const valueClass =
    accent === "blue"
      ? "text-blue-400"
      : accent === "amber"
        ? "text-amber-400"
        : "text-white";

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", valueClass)}>
        {value}
      </p>
    </div>
  );
}
