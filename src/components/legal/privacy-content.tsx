import { LEGAL_CONFIG } from "@/lib/legal/config";
import { LegalSection } from "./legal-section";

const {
  productName,
  entityName,
  registeredAddress,
  supportEmail,
  privacyEmail,
  grievanceOfficerName,
  grievanceOfficerEmail,
  effectiveDate,
} = LEGAL_CONFIG;

export function PrivacyContent() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-1 text-sm text-slate-500">
          Effective date: {effectiveDate}
        </p>
      </div>

      <LegalSection title="1. Who we are">
        <p>
          {productName} is a WhatsApp Business CRM operated by{" "}
          <strong className="text-white">{entityName}</strong> (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;, &ldquo;our&rdquo;), registered at{" "}
          {registeredAddress}. This policy explains what personal data we
          collect when you use {productName}, why we collect it, and what
          rights you have over it.
        </p>
      </LegalSection>

      <LegalSection title="2. What data we collect">
        <p>We collect the following categories of data:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-white">Account data</strong> — name, email
            address, password (hashed), and profile photo you provide when
            you sign up or update your profile.
          </li>
          <li>
            <strong className="text-white">Team & workspace data</strong> —
            account name, member roles, and invitations you create for your
            organisation.
          </li>
          <li>
            <strong className="text-white">WhatsApp communications data</strong>{" "}
            — contact details, message content, media, and delivery status
            synced from your connected WhatsApp Business Account via the Meta
            Cloud API, so your team can manage conversations inside{" "}
            {productName}.
          </li>
          <li>
            <strong className="text-white">CRM data you create</strong> —
            contacts, tags, notes, sales pipeline deals, broadcasts, and
            automation configurations.
          </li>
          <li>
            <strong className="text-white">Billing data</strong> — plan
            selection, subscription status, and payment references from our
            payment processor (Razorpay). We do not store your card, UPI, or
            bank details — Razorpay handles and stores payment instruments
            directly.
          </li>
          <li>
            <strong className="text-white">Usage & log data</strong> — IP
            address, browser type, and actions taken in the product, used for
            security, rate-limiting, and debugging.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. How we use your data">
        <ul className="list-disc space-y-1 pl-5">
          <li>To provide, operate, and maintain the {productName} service.</li>
          <li>
            To send and receive WhatsApp messages on your behalf through the
            Meta Cloud API, exactly as instructed by your team.
          </li>
          <li>To process subscription payments and manage billing.</li>
          <li>
            To provide customer support and respond to your requests.
          </li>
          <li>
            To detect, prevent, and address fraud, abuse, and security
            issues.
          </li>
          <li>
            To send you service-related notifications (e.g. trial expiry,
            payment failure). We do not send marketing email without your
            consent.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Third parties we share data with">
        <p>
          We share data only with service providers necessary to run{" "}
          {productName}, each bound by their own data protection terms:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-white">Meta Platforms, Inc.</strong> —
            operates the WhatsApp Business Cloud API used to send and receive
            messages on your behalf.
          </li>
          <li>
            <strong className="text-white">Supabase</strong> — hosts our
            database, authentication, and file storage infrastructure.
          </li>
          <li>
            <strong className="text-white">Razorpay Software Private
            Limited</strong> — processes subscription payments and stores
            payment instrument data under its own PCI-DSS compliant systems.
          </li>
          <li>
            <strong className="text-white">OpenAI</strong> — powers optional
            AI reply-suggestion and AI agent features, if you enable them.
            Message content is sent to OpenAI only when you use these
            features.
          </li>
        </ul>
        <p>
          We do not sell your personal data. We disclose data to law
          enforcement only when legally required to do so.
        </p>
      </LegalSection>

      <LegalSection title="5. Data retention and deletion">
        <p>
          We retain your data for as long as your account is active. If you
          cancel your subscription, your data remains available for 30 days
          in case you wish to reactivate, after which it is permanently
          deleted from active systems (backups age out on their own retention
          schedule). You can request earlier deletion by contacting{" "}
          {supportEmail}.
        </p>
      </LegalSection>

      <LegalSection title="6. Security">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            WhatsApp access tokens are encrypted at rest with AES-256-GCM.
          </li>
          <li>
            Every inbound Meta webhook is verified with an HMAC-SHA256
            signature.
          </li>
          <li>
            Row-level security in our database ensures no account can read
            another account&apos;s data.
          </li>
          <li>
            Traffic is encrypted in transit with TLS; passwords are hashed,
            never stored in plaintext.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Your rights">
        <p>
          Subject to applicable law (including India&apos;s Digital Personal
          Data Protection Act, 2023), you may request access to, correction
          of, or deletion of your personal data, and may withdraw consent for
          optional processing (such as AI features) at any time. Contact{" "}
          {privacyEmail} to exercise these rights.
        </p>
      </LegalSection>

      <LegalSection title="8. Cookies and local storage">
        <p>
          We use session cookies and browser local storage strictly to keep
          you signed in and to remember interface preferences (such as light
          or dark mode). We do not use third-party advertising or tracking
          cookies.
        </p>
      </LegalSection>

      <LegalSection title="9. Children's privacy">
        <p>
          {productName} is a business tool and is not directed at, or
          knowingly used by, children under 18. We do not knowingly collect
          personal data from children.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes to this policy">
        <p>
          We may update this policy from time to time. Material changes will
          be notified via email or an in-product notice. Continued use of{" "}
          {productName} after a change takes effect constitutes acceptance of
          the revised policy.
        </p>
      </LegalSection>

      <LegalSection title="11. Contact us / Grievance officer">
        <p>
          For any privacy questions, contact us at {privacyEmail}. In
          accordance with Indian law, our designated Grievance Officer is:
        </p>
        <p>
          {grievanceOfficerName}
          <br />
          {entityName}
          <br />
          {registeredAddress}
          <br />
          Email: {grievanceOfficerEmail}
        </p>
      </LegalSection>
    </div>
  );
}
