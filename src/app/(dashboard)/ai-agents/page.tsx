"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Bot,
} from "lucide-react";

import type { AiAgent } from "@/types";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { useCan } from "@/hooks/use-can";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export default function AiAgentsPage() {
  const router = useRouter();
  const canManage = useCan("send-messages");
  const [agents, setAgents] = useState<AiAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AiAgent | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/ai-agents", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Failed to load (${res.status})`);
      }
      const data = await res.json();
      setAgents((data.agents ?? []) as AiAgent[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai-agents/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed");
      }
      toast.success("Agent deleted");
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="size-7 text-primary" />
            AI Agents
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-xl">
            Create AI personas with custom instructions, then use them in
            Automations with the <strong className="text-slate-300">AI Reply</strong> step.
          </p>
        </div>
        <GatedButton
          canAct={canManage}
          gateReason="create AI agents"
          onClick={() => router.push("/ai-agents/new")}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Create Agent
        </GatedButton>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {agents === null ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="size-6 animate-spin mr-2" />
          Loading agents…
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-12 text-center">
          <Bot className="size-12 mx-auto text-slate-600 mb-4" />
          <h2 className="text-lg font-semibold text-white mb-2">No AI agents yet</h2>
          <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">
            Create an agent with a custom persona — for example a palm reader,
            support bot, or sales qualifier — then wire it into an automation.
          </p>
          <GatedButton
            canAct={canManage}
            gateReason="create AI agents"
            onClick={() => router.push("/ai-agents/new")}
          >
            <Plus className="size-4" />
            Create your first agent
          </GatedButton>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-xl border border-slate-800 bg-slate-900 p-5 flex flex-col"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-semibold text-white">{agent.name}</h3>
                  {agent.description && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                      {agent.description}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    agent.status === "active"
                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-600/30"
                      : "bg-slate-800 text-slate-400 border border-slate-700",
                  )}
                >
                  {agent.status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-4 line-clamp-3 flex-1">
                {agent.system_prompt}
              </p>
              <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-300 hover:text-white"
                  onClick={() => router.push(`/ai-agents/${agent.id}/edit`)}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300 ml-auto"
                  disabled={!canManage}
                  onClick={() => setPendingDelete(agent)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!pendingDelete} onOpenChange={() => setPendingDelete(null)}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">Delete agent?</DialogTitle>
            <DialogDescription>
              &quot;{pendingDelete?.name}&quot; will be removed. Automations using
              this agent will fail until you pick a different one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
