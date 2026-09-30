import { describe, expect, it } from "vitest";

import { bot, customer, emptySession, fakeLlm, recordingBooking, testAgent, testRuntime, testServices } from "../testing/fakes";
import type { ChatTurn, SessionState } from "../types";
import { defaultAgentConfig, type BookingField } from "./catalog";
import type { SpecialistContext } from "./contract";
import {
  decideBookingAction,
  normaliseFieldValue,
  ticketBookingSpecialist,
} from "./ticket-booking";

const today = "2026-09-30";
const field = (type: BookingField["type"]): BookingField => ({ key: "x", label: "X", type, required: true });

describe("normaliseFieldValue", () => {
  it("validates by type", () => {
    expect(normaliseFieldValue(field("number"), "3 tickets", today)).toBe("3");
    expect(normaliseFieldValue(field("number"), "0", today)).toBeNull();
    expect(normaliseFieldValue(field("date"), "2026-10-05", today)).toBe("2026-10-05");
    expect(normaliseFieldValue(field("date"), "2026-09-01", today)).toBeNull();
    expect(normaliseFieldValue(field("date"), "2026-02-30", today)).toBeNull();
    expect(normaliseFieldValue(field("email"), "A@B.COM", today)).toBe("a@b.com");
    expect(normaliseFieldValue(field("phone"), "+91 98765 43210", today)).toBe("+919876543210");
    expect(normaliseFieldValue(field("text"), "  ", today)).toBeNull();
  });
});

describe("decideBookingAction", () => {
  const base = { stage: "collecting" as const, missingCount: 0, confirmation: "none" as const, changed: false };

  it("asks for missing fields first", () => {
    expect(decideBookingAction({ ...base, missingCount: 2 })).toBe("ask_missing");
  });
  it("checks availability once everything is known", () => {
    expect(decideBookingAction(base)).toBe("check_availability");
  });
  it("books only on an explicit yes while awaiting confirmation", () => {
    expect(decideBookingAction({ ...base, stage: "awaiting_confirmation", confirmation: "yes" })).toBe("book");
    expect(decideBookingAction({ ...base, stage: "collecting", confirmation: "yes" })).toBe("check_availability");
    expect(decideBookingAction({ ...base, stage: "awaiting_confirmation" })).toBe("confirm");
    expect(decideBookingAction({ ...base, stage: "awaiting_confirmation", confirmation: "no" })).toBe("ask_change");
  });
  it("re-checks instead of booking when details changed in the same message", () => {
    expect(
      decideBookingAction({ ...base, stage: "awaiting_confirmation", confirmation: "yes", changed: true }),
    ).toBe("check_availability");
  });
});

describe("ticketBookingSpecialist (multi-turn)", () => {
  const config = {
    ...defaultAgentConfig("ticket_booking"),
    booking_webhook_url: "https://book.example.com",
  };

  function run(
    transcript: ChatTurn[],
    session: SessionState,
    extract: Record<string, unknown>,
    booking = recordingBooking(),
  ) {
    const llm = fakeLlm(
      {
        booking_extract: () => extract,
        booking_confirm: () => ({ intro: "Here's your booking:", closing: "Reply YES to confirm." }),
        booking_done: () => ({ intro: "You're booked!", closing: "Enjoy the show." }),
      },
      () => "Could you tell me your full name?",
    );
    const ctx: SpecialistContext<"ticket_booking"> = {
      agent: testAgent({ agent_type: "ticket_booking" }),
      config,
      transcript,
      session,
      contactName: "",
      conversationKey: "conv-1",
      refs: null,
      llm,
      runtime: testRuntime,
      services: testServices({ booking: booking.client }),
      now: new Date("2026-09-30T10:00:00Z"),
    };
    return { result: ticketBookingSpecialist.run(ctx), booking, llm };
  }

  it("collects, confirms, then books exactly once", async () => {
    const t1 = [customer("2 tickets for Hamlet on 5 Oct")];
    const turn1 = run(t1, emptySession(), {
      values: [
        { key: "event", value: "Hamlet" },
        { key: "date", value: "2099-10-05" },
        { key: "tickets", value: "2" },
      ],
      confirmation: "none",
      new_booking: false,
    });
    const r1 = await turn1.result;
    expect(r1.session?.stage).toBe("collecting");
    expect(r1.reply).toContain("full name");
    expect(turn1.booking.calls).toEqual([]);

    const s1 = emptySession({ stage: r1.session!.stage!, slots: r1.session!.slots! });
    const t2 = [...t1, bot(r1.reply!), customer("Priya Nair")];
    const turn2 = run(t2, s1, { values: [{ key: "name", value: "Priya Nair" }], confirmation: "none", new_booking: false });
    const r2 = await turn2.result;
    expect(r2.session?.stage).toBe("awaiting_confirmation");
    expect(r2.reply).toContain("*Full name:* Priya Nair");
    expect(r2.reply).toContain("Reply YES to confirm.");
    expect(turn2.booking.calls.map((c) => c.op)).toEqual(["availability"]);

    const s2 = emptySession({ stage: r2.session!.stage!, slots: r2.session!.slots! });
    const t3 = [...t2, bot(r2.reply!), customer("yes please")];
    const turn3 = run(t3, s2, { values: [], confirmation: "yes", new_booking: false });
    const r3 = await turn3.result;
    expect(r3.session?.stage).toBe("booked");
    expect(r3.reply).toContain("BK-42");
    expect(turn3.booking.calls.map((c) => c.op)).toEqual(["book"]);
    expect(turn3.booking.calls[0].details).toMatchObject({ name: "Priya Nair", tickets: "2" });
  });

  it("never books from a 'yes' before details were confirmed", async () => {
    const turn = run([customer("yes book it")], emptySession(), {
      values: [{ key: "event", value: "Hamlet" }],
      confirmation: "yes",
      new_booking: false,
    });
    const r = await turn.result;
    expect(turn.booking.calls).toEqual([]);
    expect(r.session?.stage).toBe("collecting");
  });

  it("hands off when the booking webhook rejects the booking", async () => {
    const booking = recordingBooking({
      async createBooking() {
        return { success: false, message: "sold out" };
      },
    });
    const session = emptySession({
      stage: "awaiting_confirmation",
      slots: { details: { event: "Hamlet", date: "2099-10-05", tickets: "2", name: "Priya" } },
    });
    const turn = run([customer("yes")], session, { values: [], confirmation: "yes", new_booking: false }, booking);
    const r = await turn.result;
    expect(r.handoff).toBe(true);
    expect(r.reply).toBeNull();
  });
});
