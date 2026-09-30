import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import type { LlmToolkit, ModelSpec } from "../llm/toolkit";
import type { Usage } from "../types";

export const imageAnalysisSchema = z.object({
  image_type: z
    .enum(["palm", "payment_receipt", "other"])
    .describe("palm = photo of a human palm/hand; payment_receipt = screenshot of a payment confirmation"),
  payment_status: z.enum(["success", "pending", "failed", "unknown"]),
  amount: z.number().describe("Amount paid in rupees as shown; 0 if not visible"),
  currency: z.string().describe("e.g. INR; empty if not visible"),
  payee_name: z.string().describe("Who was paid, exactly as shown; empty if not visible"),
  payee_handle: z.string().describe("UPI ID / Razorpay handle / merchant id as shown; empty if not visible"),
  razorpay_payment_id: z.string().describe("Razorpay payment id starting with pay_ if visible, else empty"),
  utr: z.string().describe("UPI transaction id / UTR / bank reference number if visible, else empty"),
  paid_at: z
    .string()
    .describe("Date and time shown on the receipt as YYYY-MM-DDTHH:MM (24h, as displayed); empty if not visible"),
  app: z.string().describe("App or provider shown, e.g. Razorpay, Google Pay, PhonePe, Paytm, bank app"),
  edit_suspicion: z
    .enum(["none", "low", "high"])
    .describe("Signs of editing: mismatched fonts, misaligned digits, blur/patches around amount, name or id"),
  notes: z.string().describe("One short sentence about anything unusual"),
});
export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;

const PROMPT = `You inspect one image a customer sent on WhatsApp to a palm-reading business.

1. Classify it: a photo of a palm/hand, a payment receipt/confirmation screenshot, or other.
2. If it is a payment receipt, transcribe the fields EXACTLY as displayed. Never guess or complete partially visible values; leave a field empty (or amount 0) if it is not clearly readable.
3. Judge edit_suspicion honestly: look for inconsistent fonts, spacing or alignment around the amount, payee, date and transaction ids, pasted patches, or blur limited to key fields.
If it is not a receipt, set payment_status=unknown, amount=0 and leave receipt fields empty.`;

export async function analyzeCustomerImage(
  llm: LlmToolkit,
  spec: ModelSpec,
  imageDataUrl: string,
  config?: RunnableConfig,
): Promise<{ data: ImageAnalysis; usage: Usage }> {
  return llm.structured(
    spec,
    imageAnalysisSchema,
    "analyze_customer_image",
    [
      new SystemMessage(PROMPT),
      new HumanMessage({
        content: [
          { type: "text", text: "Inspect this image." },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
        ],
      }),
    ],
    config,
  );
}
