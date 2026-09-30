import type { RunnableConfig } from "@langchain/core/runnables";

import type { GeoPlace } from "../astrology/geocode";
import type { AgentRuntimeConfig } from "../config";
import type { LlmToolkit } from "../llm/toolkit";
import type { PaymentDecision, PaymentRules } from "../payments/decide";
import type { ImageAnalysis } from "../payments/receipt";
import type { ReportSubject } from "../reports/schema";
import type { BookingClient } from "../tools/booking";
import type { AgentKind, ChatTurn, RuntimeAgent, SessionState, Usage } from "../types";
import type { AgentKindConfigMap } from "./catalog";

export interface ConversationRefs {
  conversationId: string;
  contactId: string;
  userId: string;
}

export interface PaymentCheckRequest {
  agent: RuntimeAgent;
  refs: ConversationRefs;
  screenshotMessageId: string | null;
  analysis: ImageAnalysis;
  rules: PaymentRules;
}

export interface PaymentService {
  /** Verify and record a payment screenshot. Never trusts the customer's words. */
  check(req: PaymentCheckRequest): Promise<{ decision: PaymentDecision; paymentId: string | null }>;
}

export interface ReportRequest {
  agent: RuntimeAgent;
  refs: ConversationRefs;
  paymentId: string;
  subject: ReportSubject;
  palmMediaUrls: string[];
}

export interface ReportService {
  resolvePlace(place: string): Promise<GeoPlace | null>;
  /** Idempotent per payment: a second call returns the existing report. */
  requestReport(req: ReportRequest): Promise<{ reportId: string; created: boolean }>;
}

export interface SpecialistServices {
  booking: BookingClient;
  payments: PaymentService;
  reports: ReportService;
}

export interface SpecialistContext<K extends AgentKind = AgentKind> {
  agent: RuntimeAgent;
  config: AgentKindConfigMap[K];
  transcript: ChatTurn[];
  session: SessionState;
  contactName: string;
  /** Stable per-conversation key (idempotency for side effects). */
  conversationKey: string;
  /** Null in dry runs without a real conversation. */
  refs: ConversationRefs | null;
  llm: LlmToolkit;
  runtime: AgentRuntimeConfig;
  services: SpecialistServices;
  now: Date;
  runnableConfig?: RunnableConfig;
}

export interface SpecialistResult {
  reply: string | null;
  handoff?: boolean;
  session?: Partial<Pick<SessionState, "stage" | "slots" | "summary">>;
  usage: Usage;
  /** Internal steps, appended to the run's node path. */
  steps: string[];
}

export interface Specialist<K extends AgentKind> {
  kind: K;
  run(ctx: SpecialistContext<K>): Promise<SpecialistResult>;
}
