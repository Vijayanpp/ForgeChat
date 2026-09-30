import { createHash } from "node:crypto";
import { z } from "zod";

import type { TicketBookingConfig } from "../kinds/catalog";
import { postSignedJson, type SignedPostOptions } from "./http-tool";

export interface BookingRequestContext {
  accountId: string;
  agentId: string;
  conversationKey: string;
}

const availabilityResponse = z.object({
  available: z.boolean(),
  message: z.string().max(1000).optional(),
  alternatives: z.array(z.string().max(200)).max(10).optional(),
});

const bookingResponse = z.object({
  success: z.boolean(),
  reference: z.string().max(200).optional(),
  message: z.string().max(1000).optional(),
});

export type AvailabilityResult = z.output<typeof availabilityResponse>;
export type BookingResult = z.output<typeof bookingResponse>;

export interface BookingClient {
  checkAvailability(
    config: TicketBookingConfig,
    details: Record<string, unknown>,
    ctx: BookingRequestContext,
  ): Promise<AvailabilityResult | null>;
  createBooking(
    config: TicketBookingConfig,
    details: Record<string, unknown>,
    ctx: BookingRequestContext,
  ): Promise<BookingResult>;
}

/** Same details from the same conversation always map to the same key. */
export function bookingIdempotencyKey(conversationKey: string, details: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(details)
      .sort()
      .map((k) => [k, details[k]]),
  );
  return createHash("sha256").update(`${conversationKey}|${canonical}`).digest("hex").slice(0, 40);
}

export function createWebhookBookingClient(
  overrides: Pick<SignedPostOptions, "fetchImpl" | "resolve"> = {},
): BookingClient {
  return {
    async checkAvailability(config, details, ctx) {
      if (!config.availability_webhook_url) return null;
      const raw = await postSignedJson(
        config.availability_webhook_url,
        { type: "availability_check", agent_id: ctx.agentId, details },
        {
          ...overrides,
          secret: config.webhook_secret,
          idempotencyKey: `avail-${bookingIdempotencyKey(ctx.conversationKey, details)}`,
        },
      );
      const parsed = availabilityResponse.safeParse(raw);
      if (!parsed.success) throw new Error("availability webhook returned an unexpected shape");
      return parsed.data;
    },

    async createBooking(config, details, ctx) {
      if (!config.booking_webhook_url) {
        throw new Error("booking webhook URL is not configured");
      }
      const raw = await postSignedJson(
        config.booking_webhook_url,
        { type: "create_booking", agent_id: ctx.agentId, details },
        {
          ...overrides,
          secret: config.webhook_secret,
          idempotencyKey: `book-${bookingIdempotencyKey(ctx.conversationKey, details)}`,
        },
      );
      const parsed = bookingResponse.safeParse(raw);
      if (!parsed.success) throw new Error("booking webhook returned an unexpected shape");
      return parsed.data;
    },
  };
}
