import { describe, expect, it } from "vitest";

import { resolveRuntimeFields } from "./api";
import { defaultAgentConfig, parseAgentConfig } from "./kinds/catalog";

describe("agent config schemas", () => {
  it("fills defaults for every kind", () => {
    expect(defaultAgentConfig("ticket_booking").fields.length).toBeGreaterThan(0);
    expect(defaultAgentConfig("sales").qualification_fields.map((f) => f.key)).toContain("budget");
    expect(defaultAgentConfig("customer_service").handoff_when_unknown).toBe(true);
  });

  it("rejects non-https webhooks and bad field keys", () => {
    expect(parseAgentConfig("ticket_booking", { booking_webhook_url: "http://x.com" })).toMatchObject({ ok: false });
    expect(
      parseAgentConfig("sales", { qualification_fields: [{ key: "Bad Key", label: "x" }] }),
    ).toMatchObject({ ok: false });
  });
});

describe("resolveRuntimeFields", () => {
  it("defaults to the legacy engine", () => {
    const r = resolveRuntimeFields({});
    expect(r).toMatchObject({ ok: true, fields: { engine: "legacy", agent_type: null }, changed: false });
  });

  it("requires an agent type for the LangGraph engine", () => {
    expect(resolveRuntimeFields({ engine: "langgraph" })).toMatchObject({ ok: false });
  });

  it("generates a booking webhook secret and keeps it across updates", () => {
    const created = resolveRuntimeFields({ engine: "langgraph", agent_type: "ticket_booking", config: {} });
    if (!created.ok) throw new Error(created.error);
    const secret = created.fields.config.webhook_secret as string;
    expect(secret).toMatch(/^[a-f0-9]{48}$/);

    const updated = resolveRuntimeFields(
      { config: { business_name: "Theatre", webhook_secret: "" } },
      { engine: "langgraph", agent_type: "ticket_booking", config: created.fields.config },
    );
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.fields.config.webhook_secret).toBe(secret);
    expect(updated.changed).toBe(true);
  });

  it("validates config against the kind schema", () => {
    const r = resolveRuntimeFields({
      engine: "langgraph",
      agent_type: "palm_reading",
      config: { offer_link: "ftp://nope" },
    });
    expect(r.ok).toBe(false);
  });
});
