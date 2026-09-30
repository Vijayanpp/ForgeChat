import { supabaseAdmin } from "@/lib/automations/admin-client";

import { createOpenMeteoGeocoder } from "../astrology/geocode";
import { agentRuntimeConfig } from "../config";
import type { AgentGraphDeps } from "../graph/shell";
import { createOpenAiToolkit } from "../llm/toolkit";
import { scheduleReportDrain } from "../reports/runtime";
import {
  createPaymentService,
  createReportService,
  dryRunPaymentService,
  dryRunReportService,
} from "../reports/service";
import { createWebhookBookingClient, type BookingClient } from "../tools/booking";

let deps: AgentGraphDeps | null = null;
const geocoder = createOpenMeteoGeocoder();

export function defaultAgentDeps(): AgentGraphDeps {
  deps ??= {
    llm: createOpenAiToolkit(),
    services: {
      booking: createWebhookBookingClient(),
      payments: createPaymentService(supabaseAdmin),
      reports: createReportService(supabaseAdmin, geocoder, scheduleReportDrain),
    },
    runtime: agentRuntimeConfig(),
  };
  return deps;
}

/** Booking client for dry runs: never calls the business webhook. */
export const dryRunBookingClient: BookingClient = {
  async checkAvailability() {
    return { available: true, message: "(test mode: availability not checked)" };
  },
  async createBooking() {
    return { success: true, reference: "TEST-0000", message: "(test mode: nothing was booked)" };
  },
};

let dryRunDeps: AgentGraphDeps | null = null;

/** Dry runs never book, record payments or queue reports. */
export function dryRunAgentDeps(): AgentGraphDeps {
  dryRunDeps ??= {
    ...defaultAgentDeps(),
    services: {
      booking: dryRunBookingClient,
      payments: dryRunPaymentService,
      reports: dryRunReportService(geocoder),
    },
  };
  return dryRunDeps;
}
