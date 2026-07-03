import type { Metadata } from "next";
import { PricingContent } from "@/components/legal/pricing-content";

export const metadata: Metadata = {
  title: "Pricing",
};

export default function PricingPage() {
  return <PricingContent />;
}
