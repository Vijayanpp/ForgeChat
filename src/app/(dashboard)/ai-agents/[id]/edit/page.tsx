"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AiAgentForm } from "@/components/ai-agents/agent-form";
import type { AiAgent } from "@/types";

export default function EditAiAgentPage() {
  const params = useParams();
  const id = params.id as string;
  const [agent, setAgent] = useState<AiAgent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/ai-agents/${id}`, { cache: "no-store" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to load agent");
        }
        const data = await res.json();
        if (!cancelled) setAgent(data.agent as AiAgent);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load agent");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
        {error}
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="size-6 animate-spin mr-2" />
        Loading agent…
      </div>
    );
  }

  return <AiAgentForm mode="edit" initial={agent} />;
}
