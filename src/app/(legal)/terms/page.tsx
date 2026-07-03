import type { Metadata } from "next";
import { TermsContent } from "@/components/legal/terms-content";

export const metadata: Metadata = {
  title: "Terms & Conditions",
};

export default function TermsPage() {
  return <TermsContent />;
}
