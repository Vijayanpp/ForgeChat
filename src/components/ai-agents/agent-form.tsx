"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, RotateCcw, Sparkles, Workflow } from "lucide-react";

import type { AiAgent } from "@/types";
import { AI_AGENT_STARTER_TEMPLATES } from "@/lib/ai/agent-templates";
import {
  AGENT_KIND_CATALOG,
  defaultAgentConfig,
  parseAgentConfig,
} from "@/lib/agents/kinds/catalog";
import { AGENT_KINDS, type AgentEngine, type AgentKind } from "@/lib/agents/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { KindConfigFields, type AgentConfigDraft } from "./kind-config-fields";

interface AiAgentFormProps {
  mode: "create" | "edit";
  initial?: AiAgent;
}

interface TestTurn {
  role: "user" | "assistant";
  content: string;
  meta?: string;
}

const SHARED_CONFIG_KEYS = ["business_name", "handoff_keywords", "handoff_message"] as const;

function cleanConfig(config: AgentConfigDraft): AgentConfigDraft {
  const keywords = Array.isArray(config.handoff_keywords)
    ? (config.handoff_keywords as string[]).map((k) => k.trim()).filter(Boolean)
    : [];
  return { ...config, handoff_keywords: keywords };
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
  const [engine, setEngine] = useState<AgentEngine>(initial?.engine ?? "legacy");
  const [kind, setKind] = useState<AgentKind>(initial?.agent_type ?? "customer_service");
  const [config, setConfig] = useState<AgentConfigDraft>(
    () => initial?.config ?? (defaultAgentConfig(initial?.agent_type ?? "customer_service") as AgentConfigDraft),
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState(
    "Hi, can you help me?",
  );
  const [testReply, setTestReply] = useState<string | null>(null);
  const [testThread, setTestThread] = useState<TestTurn[]>([]);
  const [testSession, setTestSession] = useState<unknown>(null);

  const isGraph = engine === "langgraph";

  function changeKind(next: AgentKind) {
    if (next === kind) return;
    const shared = Object.fromEntries(
      SHARED_CONFIG_KEYS.filter((k) => k in config).map((k) => [k, config[k]]),
    );
    setKind(next);
    setConfig({ ...(defaultAgentConfig(next) as AgentConfigDraft), ...shared });
    resetTest();
  }

  function applyTemplate(slug: string) {
    const t = AI_AGENT_STARTER_TEMPLATES.find((x) => x.slug === slug);
    if (!t) return;
    if (!name.trim()) setName(t.name);
    if (!description.trim()) setDescription(t.description);
    setSystemPrompt(t.system_prompt);
    setTemperature(t.temperature);
    setEngine("legacy");
    toast.success(`Applied "${t.name}" template`);
  }

  function applyKindStarter(next: AgentKind) {
    const starter = AGENT_KIND_CATALOG[next].starter;
    setEngine("langgraph");
    setKind(next);
    setConfig(defaultAgentConfig(next) as AgentConfigDraft);
    if (!name.trim()) setName(starter.name);
    if (!description.trim()) setDescription(starter.description);
    setSystemPrompt(starter.systemPrompt);
    setTemperature(starter.temperature);
    resetTest();
    toast.success(`Applied "${starter.name}" template`);
  }

  function resetTest() {
    setTestThread([]);
    setTestSession(null);
    setTestReply(null);
  }

  async function handleSave() {
    if (!name.trim() || !systemPrompt.trim()) {
      toast.error("Name and persona instructions are required");
      return;
    }

    const cleaned = cleanConfig(config);
    if (isGraph) {
      const parsed = parseAgentConfig(kind, cleaned);
      if (!parsed.ok) {
        toast.error(`Agent settings: ${parsed.error}`);
        return;
      }
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
        engine,
        agent_type: isGraph ? kind : (initial?.agent_type ?? null),
        config: isGraph ? cleaned : (initial?.config ?? {}),
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
      if (data.agent?.config) setConfig(data.agent.config as AgentConfigDraft);
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
    const message = testMessage.trim();
    if (!message) {
      toast.error("Enter a sample customer message");
      return;
    }

    setTesting(true);
    setTestReply(null);
    try {
      const res = await fetch(`/api/ai-agents/${initial.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: testThread.map(({ role, content }) => ({ role, content })),
          session: testSession,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Test failed");
      }
      const data = await res.json();

      if (data.nodePath) {
        const reply = (data.reply as string | null) ?? "(no reply sent)";
        const tokens = (data.usage?.promptTokens ?? 0) + (data.usage?.completionTokens ?? 0);
        setTestThread((prev) => [
          ...prev,
          { role: "user", content: message },
          {
            role: "assistant",
            content: reply,
            meta: `${data.outcome} · ${(data.nodePath as string[]).join(" → ")} · ${tokens} tokens`,
          },
        ]);
        setTestSession(data.session ?? null);
        setTestMessage("");
      } else {
        setTestReply(data.reply as string);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  const savedAsGraph = initial?.engine === "langgraph";

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
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">
              Smart agent templates
            </p>
            <div className="flex flex-wrap gap-2">
              {AGENT_KINDS.map((k) => (
                <Button
                  key={k}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-slate-700 text-slate-300"
                  onClick={() => applyKindStarter(k)}
                >
                  <Workflow className="size-3.5" />
                  {AGENT_KIND_CATALOG[k].starter.name}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">
              Simple persona templates
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
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <p className="text-sm font-medium text-slate-300 mb-2">Agent engine</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  id: "legacy",
                  title: "Simple persona",
                  body: "One prompt, one reply. Good for chatty personas.",
                },
                {
                  id: "langgraph",
                  title: "Smart agent",
                  body: "Purpose-built workflow with memory, human hand-off and guardrails.",
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setEngine(opt.id);
                  resetTest();
                }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  engine === opt.id
                    ? "border-primary bg-primary/10"
                    : "border-slate-700 bg-slate-800/50 hover:border-slate-600",
                )}
              >
                <p className="text-sm font-medium text-white">{opt.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{opt.body}</p>
              </button>
            ))}
          </div>
        </div>

        {isGraph && (
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">Agent type</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {AGENT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => changeKind(k)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    kind === k
                      ? "border-primary bg-primary/10"
                      : "border-slate-700 bg-slate-800/50 hover:border-slate-600",
                  )}
                >
                  <p className="text-sm font-medium text-white">{AGENT_KIND_CATALOG[k].label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{AGENT_KIND_CATALOG[k].description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

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

      {isGraph && (
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {AGENT_KIND_CATALOG[kind].label} settings
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              The agent stays quiet while a teammate is replying, and hands off complaints and
              explicit requests for a person.
            </p>
          </div>
          <KindConfigFields kind={kind} config={config} onChange={setConfig} />
        </div>
      )}

      {mode === "edit" && initial && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Test agent</h2>
            {savedAsGraph && testThread.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-slate-400"
                onClick={resetTest}
              >
                <RotateCcw className="size-3.5" />
                Reset conversation
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {savedAsGraph
              ? "Chat with the saved agent. Nothing is sent on WhatsApp and booking webhooks are not called."
              : "Preview a reply without sending a WhatsApp message."}
          </p>

          {testThread.length > 0 && (
            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 max-h-96 overflow-y-auto">
              {testThread.map((turn, i) => (
                <div
                  key={i}
                  className={cn("flex flex-col", turn.role === "user" ? "items-end" : "items-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                      turn.role === "user"
                        ? "bg-primary/20 text-slate-100"
                        : "bg-slate-800 text-slate-200",
                    )}
                  >
                    {turn.content}
                  </div>
                  {turn.meta && (
                    <p className="mt-1 text-[10px] text-slate-500 font-mono">{turn.meta}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <Textarea
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="Type a customer message…"
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
            ) : savedAsGraph ? (
              "Send"
            ) : (
              "Test reply"
            )}
          </Button>
          {testReply && (
            <div className="rounded-lg bg-slate-800/80 border border-slate-700 p-4 text-sm text-slate-200 whitespace-pre-wrap">
              {testReply}
            </div>
          )}
          {engine !== (initial.engine ?? "legacy") && (
            <p className="text-xs text-amber-300/80">Save to test with the engine you selected.</p>
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
