"use client";

import { Plus, Trash2 } from "lucide-react";

import { MAX_KNOWLEDGE_CHARS, MAX_PRODUCT_SUMMARY_CHARS } from "@/lib/agents/knowledge/limits";
import type { AgentKind } from "@/lib/agents/types";
import { KnowledgeUpload } from "./knowledge-upload";
import { PalmConfigFields } from "./palm-config-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type AgentConfigDraft = Record<string, unknown>;

interface Props {
  kind: AgentKind;
  config: AgentConfigDraft;
  onChange: (next: AgentConfigDraft) => void;
}

const inputClass = "mt-1 bg-slate-800 border-slate-700 text-white";
const labelClass = "text-sm font-medium text-slate-300";
const hintClass = "text-xs text-slate-500 mt-1";

function str(config: AgentConfigDraft, key: string): string {
  const v = config[key];
  return typeof v === "string" ? v : "";
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  );
}

interface RowField {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
}

function FieldListEditor({
  rows,
  withType,
  onChange,
}: {
  rows: RowField[];
  withType: boolean;
  onChange: (rows: RowField[]) => void;
}) {
  const update = (index: number, patch: Partial<RowField>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <div className="mt-2 space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Input
            value={row.key}
            onChange={(e) =>
              update(index, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })
            }
            placeholder="key"
            className="w-32 bg-slate-800 border-slate-700 text-white font-mono text-xs"
          />
          <Input
            value={row.label}
            onChange={(e) => update(index, { label: e.target.value })}
            placeholder="Label shown to the customer"
            className="flex-1 min-w-40 bg-slate-800 border-slate-700 text-white"
          />
          {withType && (
            <>
              <select
                value={row.type ?? "text"}
                onChange={(e) => update(index, { type: e.target.value })}
                className="h-9 rounded-md border border-slate-700 bg-slate-800 px-2 text-sm text-white"
              >
                <option value="text">Text</option>
                <option value="date">Date</option>
                <option value="number">Number</option>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <Switch
                  checked={row.required !== false}
                  onCheckedChange={(checked) => update(index, { required: checked })}
                />
                Required
              </label>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-slate-500 hover:text-red-400"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-slate-700 text-slate-300"
        onClick={() =>
          onChange([
            ...rows,
            withType ? { key: "", label: "", type: "text", required: true } : { key: "", label: "" },
          ])
        }
      >
        <Plus className="size-3.5" />
        Add field
      </Button>
    </div>
  );
}

export function KindConfigFields({ kind, config, onChange }: Props) {
  const set = (patch: AgentConfigDraft) => onChange({ ...config, ...patch });
  const keywords = Array.isArray(config.handoff_keywords)
    ? (config.handoff_keywords as string[]).join(", ")
    : "";

  return (
    <div className="space-y-4">
      <Field label="Business name">
        <Input
          value={str(config, "business_name")}
          onChange={(e) => set({ business_name: e.target.value })}
          placeholder="Askmypalm"
          className={inputClass}
        />
      </Field>

      {kind === "customer_service" && (
        <>
          <Field
            label="Knowledge base"
            hint="FAQs, policies, prices, hours. The agent states business facts only from here. Uploaded files are added as text below so you can review and edit before saving."
          >
            <Textarea
              value={str(config, "knowledge_base")}
              onChange={(e) => set({ knowledge_base: e.target.value })}
              placeholder={"## Shipping\nOrders ship within 2 business days…\n\n## Returns\n…"}
              className={`${inputClass} min-h-56 font-mono text-sm`}
            />
            <KnowledgeUpload
              value={str(config, "knowledge_base")}
              max={MAX_KNOWLEDGE_CHARS}
              onChange={(knowledge_base) => set({ knowledge_base })}
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-slate-800 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Hand off unknown questions</p>
              <p className="text-xs text-slate-400">
                When the knowledge base doesn&apos;t cover a question, bring in a human instead of guessing
              </p>
            </div>
            <Switch
              checked={config.handoff_when_unknown !== false}
              onCheckedChange={(checked) => set({ handoff_when_unknown: checked })}
            />
          </div>
        </>
      )}

      {kind === "palm_reading" && <PalmConfigFields config={config} set={set} />}

      {kind === "ticket_booking" && (
        <>
          <Field label="What can be booked" hint="Events, shows, prices, timings. Only source of offering facts.">
            <Textarea
              value={str(config, "offering_description")}
              onChange={(e) => set({ offering_description: e.target.value })}
              className={`${inputClass} min-h-32 text-sm`}
            />
          </Field>
          <Field label="Booking details to collect">
            <FieldListEditor
              withType
              rows={(config.fields as RowField[] | undefined) ?? []}
              onChange={(rows) => set({ fields: rows })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Availability webhook (optional)" hint="POSTed the details; returns { available, alternatives? }">
              <Input
                value={str(config, "availability_webhook_url")}
                onChange={(e) => set({ availability_webhook_url: e.target.value })}
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
            <Field label="Booking webhook" hint="Called only after the customer confirms; returns { success, reference? }">
              <Input
                value={str(config, "booking_webhook_url")}
                onChange={(e) => set({ booking_webhook_url: e.target.value })}
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
          </div>
          <Field
            label="Webhook signing secret"
            hint="Verify X-ForgeChat-Signature: t=<unix>,v1=HMAC-SHA256(secret, `${t}.${body}`)"
          >
            <Input
              readOnly
              value={str(config, "webhook_secret") || "Generated when you save"}
              className={`${inputClass} font-mono text-xs text-slate-400`}
            />
          </Field>
        </>
      )}

      {kind === "sales" && (
        <>
          <Field label="Product / offer" hint="What you sell, pricing, differentiators. Only source of product facts.">
            <Textarea
              value={str(config, "product_summary")}
              onChange={(e) => set({ product_summary: e.target.value })}
              className={`${inputClass} min-h-32 text-sm`}
            />
            <KnowledgeUpload
              value={str(config, "product_summary")}
              max={MAX_PRODUCT_SUMMARY_CHARS}
              onChange={(product_summary) => set({ product_summary })}
            />
          </Field>
          <Field label="Qualification questions">
            <FieldListEditor
              withType={false}
              rows={(config.qualification_fields as RowField[] | undefined) ?? []}
              onChange={(rows) => set({ qualification_fields: rows })}
            />
          </Field>
          <Field label="Next step link (optional)" hint="Calendar or checkout link offered once qualified">
            <Input
              value={str(config, "next_step_link")}
              onChange={(e) => set({ next_step_link: e.target.value })}
              placeholder="https://cal.com/…"
              className={inputClass}
            />
          </Field>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hand-off keywords" hint="Comma separated. Any match brings in a human immediately.">
          <Input
            value={keywords}
            onChange={(e) =>
              set({
                handoff_keywords: e.target.value
                  .split(",")
                  .map((k) => k.trimStart())
                  .filter((k, i, all) => k || i === all.length - 1),
              })
            }
            placeholder="refund, manager, complaint"
            className={inputClass}
          />
        </Field>
        <Field label="Hand-off message (optional)">
          <Input
            value={str(config, "handoff_message")}
            onChange={(e) => set({ handoff_message: e.target.value })}
            placeholder="Connecting you with our team…"
            className={inputClass}
          />
        </Field>
      </div>
    </div>
  );
}
