"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";

import type { AiAgent } from "@/types";
import { AI_AGENT_STARTER_TEMPLATES } from "@/lib/ai/agent-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface AiAgentFormProps {
  mode: "create" | "edit";
  initial?: AiAgent;
}

export function AiAgentForm({ mode, initial }: AiAgentFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? "");
  const [temperature, setTemperature] = useState(
    initial?.temperature ?? 0.8,
  );
  const [contextLimit, setContextLimit] = useState(
    initial?.context_message_limit ?? 15,
  );
  const [isActive, setIsActive] = useState(initial?.status === "active");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState(
    "Hi, can you read my palm?",
  );
  const [testReply, setTestReply] = useState<string | null>(null);

  function applyTemplate(slug: string) {
    const t = AI_AGENT_STARTER_TEMPLATES.find((x) => x.slug === slug);
    if (!t) return;
    if (!name.trim()) setName(t.name);
    if (!description.trim()) setDescription(t.description);
    setSystemPrompt(t.system_prompt);
    setTemperature(t.temperature);
    toast.success(`Applied "${t.name}" template`);
  }

  async function handleSave() {
    if (!name.trim() || !systemPrompt.trim()) {
      toast.error("Name and persona instructions are required");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        system_prompt: systemPrompt.trim(),
        model: "gpt-4o",
        temperature,
        context_message_limit: contextLimit,
        status: isActive ? "active" : "draft",
      };

      const url =
        mode === "create" ? "/api/ai-agents" : `/api/ai-agents/${initial!.id}`;
      const method = mode === "create" ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }

      const data = await res.json();
      toast.success(mode === "create" ? "Agent created" : "Agent saved");
      router.push(`/ai-agents/${data.agent.id}/edit`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (mode === "create" || !initial?.id) {
      toast.error("Save the agent first before testing");
      return;
    }
    if (!testMessage.trim()) {
      toast.error("Enter a sample customer message");
      return;
    }

    setTesting(true);
    setTestReply(null);
    try {
      const res = await fetch(`/api/ai-agents/${initial.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: testMessage.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Test failed");
      }
      const data = await res.json();
      setTestReply(data.reply as string);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="text-slate-400"
          onClick={() => router.push("/ai-agents")}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="size-6 text-primary" />
            {mode === "create" ? "Create AI Agent" : "Edit AI Agent"}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Define a persona, then use it in Automations → AI Reply step.
          </p>
        </div>
      </div>

      {mode === "create" && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-xs font-medium text-slate-400 mb-2">
            Start from a template (optional)
          </p>
          <div className="flex flex-wrap gap-2">
            {AI_AGENT_STARTER_TEMPLATES.map((t) => (
              <Button
                key={t.slug}
                type="button"
                variant="outline"
                size="sm"
                className="border-slate-700 text-slate-300"
                onClick={() => applyTemplate(t.slug)}
              >
                {t.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <label className="text-sm font-medium text-slate-300">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Askmypalm Palm Reader"
            className="mt-1 bg-slate-800 border-slate-700 text-white"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300">
            Description (optional)
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Auto-replies for spiritual reading inquiries"
            className="mt-1 bg-slate-800 border-slate-700 text-white"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300">
            Persona instructions
          </label>
          <Textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are an experienced palm reader…"
            className="mt-1 min-h-48 bg-slate-800 border-slate-700 text-white font-mono text-sm"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-300">
              Temperature ({temperature.toFixed(2)})
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-300">
              Context messages
            </label>
            <Input
              type="number"
              min={1}
              max={50}
              value={contextLimit}
              onChange={(e) =>
                setContextLimit(Math.max(1, Math.min(50, Number(e.target.value))))
              }
              className="mt-1 bg-slate-800 border-slate-700 text-white"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-800 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-white">Active</p>
            <p className="text-xs text-slate-400">
              Only active agents can be used in automations
            </p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </div>

      {mode === "edit" && initial && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-sm font-semibold text-white">Test persona</h2>
          <p className="text-xs text-slate-400">
            Preview a reply without sending a WhatsApp message.
          </p>
          <Textarea
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            className="min-h-20 bg-slate-800 border-slate-700 text-white"
          />
          <Button
            type="button"
            variant="outline"
            className="border-slate-700"
            disabled={testing}
            onClick={() => void handleTest()}
          >
            {testing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Test reply"
            )}
          </Button>
          {testReply && (
            <div className="rounded-lg bg-slate-800/80 border border-slate-700 p-4 text-sm text-slate-200 whitespace-pre-wrap">
              {testReply}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          className="bg-primary text-primary-foreground"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save agent"
          )}
        </Button>
        <Button variant="ghost" onClick={() => router.push("/ai-agents")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
