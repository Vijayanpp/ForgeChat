import { LEGAL_CONFIG } from "@/lib/legal/config";
import { LegalSection } from "./legal-section";

const { productName, entityName, registeredAddress, supportEmail, jurisdiction, effectiveDate } =
  LEGAL_CONFIG;

export function TermsContent() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Terms & Conditions</h1>
        <p className="mt-1 text-sm text-slate-500">
          Effective date: {effectiveDate}
        </p>
      </div>

      <LegalSection title="1. Acceptance of terms">
        <p>
          These Terms & Conditions (&ldquo;Terms&rdquo;) govern your access to
          and use of {productName}, a WhatsApp Business CRM operated by{" "}
          <strong className="text-white">{entityName}</strong> (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;, &ldquo;our&rdquo;), registered at{" "}
          {registeredAddress}. By creating an account or using {productName},
          you agree to be bound by these Terms and our{" "}
          <a href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="2. The service">
        <p>
          {productName} lets your team connect a WhatsApp Business Account
          (via the official Meta Cloud API) to manage conversations,
          contacts, sales pipelines, broadcasts, and automations from a
          shared inbox. We are an independent product and are not affiliated
          with, endorsed by, or a representative of WhatsApp or Meta
          Platforms, Inc. Your use of WhatsApp messaging through{" "}
          {productName} is also subject to Meta&apos;s WhatsApp Business
          Messaging Policy and Meta&apos;s own terms.
        </p>
      </LegalSection>

      <LegalSection title="3. Account registration and eligibility">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            You must be at least 18 years old and have authority to bind your
            business to these Terms.
          </li>
          <li>
            You are responsible for maintaining the confidentiality of your
            login credentials and for all activity under your account.
          </li>
          <li>
            The information you provide during signup must be accurate and
            kept up to date.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Acceptable use">
        <p>You agree not to use {productName} to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Send unsolicited bulk messages, spam, or messages that violate
            WhatsApp&apos;s Business Messaging Policy.
          </li>
          <li>
            Send content that is unlawful, fraudulent, defamatory, or
            infringes on any third party&apos;s rights.
          </li>
          <li>
            Attempt to gain unauthorized access to another account or to our
            infrastructure, or to disrupt the service.
          </li>
          <li>
            Reverse-engineer, resell, or white-label the service without our
            written consent.
          </li>
        </ul>
        <p>
          We may suspend or terminate accounts that violate this section,
          including accounts whose WhatsApp Business Account is banned or
          restricted by Meta as a result of policy violations.
        </p>
      </LegalSection>

      <LegalSection title="5. Subscriptions, billing, and payment">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Paid plans are billed in Indian Rupees (INR) on a recurring
            monthly or annual basis through our payment processor, Razorpay.
          </li>
          <li>
            By subscribing, you authorize us (via Razorpay) to charge your
            chosen payment method automatically at the start of each billing
            cycle until you cancel.
          </li>
          <li>
            Plan limits (team seats, contacts, broadcasts, automations, and
            similar usage caps) are described on our{" "}
            <a href="/pricing" className="text-primary hover:underline">
              Pricing
            </a>{" "}
            page and may change with advance notice.
          </li>
          <li>
            You can cancel your subscription at any time from Settings →
            Billing. Cancellation takes effect at the end of the current
            billing period; we do not provide prorated refunds for partial
            periods except where required by law.
          </li>
          <li>
            If a payment fails, we may downgrade your account to read-only
            access until payment is resolved.
          </li>
          <li>
            Prices exclude applicable taxes (e.g. GST), which are added at
            checkout where required.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Free trial">
        <p>
          New accounts receive a time-limited free trial with the features
          described at signup. We may modify or discontinue the trial offer
          at any time. At the end of the trial, continued use requires an
          active paid subscription; unpaid accounts move to read-only access.
        </p>
      </LegalSection>

      <LegalSection title="7. Team members and account ownership">
        <p>
          The account owner is responsible for all activity performed by
          members they invite, including messages sent and data entered by
          those members. Ownership of an account can be transferred to
          another member using the in-product transfer flow. Removing a
          member from your account does not delete that person&apos;s own
          {" "}{productName} login — they are moved to a new, empty personal
          account.
        </p>
      </LegalSection>

      <LegalSection title="8. Third-party dependency (WhatsApp / Meta)">
        <p>
          {productName} depends on the availability and policies of the Meta
          WhatsApp Cloud API. We are not responsible for outages, message
          delivery failures, template rejections, or account restrictions
          caused by Meta&apos;s infrastructure or its enforcement of its own
          policies.
        </p>
      </LegalSection>

      <LegalSection title="9. Intellectual property">
        <p>
          {productName}, its logo, and its software are our intellectual
          property or that of our licensors. You retain ownership of the
          contact, message, and business data you upload; you grant us a
          limited license to process it solely to provide the service to
          you.
        </p>
      </LegalSection>

      <LegalSection title="10. Disclaimers and limitation of liability">
        <p>
          The service is provided &ldquo;as is&rdquo; without warranties of
          any kind, express or implied. To the maximum extent permitted by
          law, {entityName} shall not be liable for any indirect,
          incidental, or consequential damages, or for any loss of profits,
          data, or business arising from your use of {productName}. Our
          total liability for any claim arising from these Terms is limited
          to the amount you paid us in the twelve months preceding the
          claim.
        </p>
      </LegalSection>

      <LegalSection title="11. Termination">
        <p>
          We may suspend or terminate your access to {productName} for
          breach of these Terms, non-payment, or conduct that we reasonably
          believe harms us, other users, or third parties. You may terminate
          your account at any time by cancelling your subscription and
          contacting {supportEmail} to request data deletion.
        </p>
      </LegalSection>

      <LegalSection title="12. Governing law and dispute resolution">
        <p>
          These Terms are governed by the laws of India. Any dispute arising
          out of or relating to these Terms shall be subject to the exclusive
          jurisdiction of the courts of {jurisdiction}.
        </p>
      </LegalSection>

      <LegalSection title="13. Changes to these terms">
        <p>
          We may update these Terms from time to time. Material changes will
          be notified via email or an in-product notice at least 15 days
          before taking effect. Continued use of {productName} after that
          date constitutes acceptance of the revised Terms.
        </p>
      </LegalSection>

      <LegalSection title="14. Contact">
        <p>
          Questions about these Terms can be sent to {supportEmail} or to{" "}
          {entityName}, {registeredAddress}.
        </p>
      </LegalSection>
    </div>
  );
}
