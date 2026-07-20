"use client";

import { useAuth } from "@/hooks/use-auth";
import {
  isAffiliateLinkVisible,
  resolveAffiliateLabel,
} from "@/lib/affiliate/config";
import { cn } from "@/lib/utils";

interface AffiliateLinkProps {
  className?: string;
}

/**
 * Muted partner / affiliate link shown under the Inbox composer.
 * Reads account-level config set by admin in Settings.
 */
export function AffiliateLink({ className }: AffiliateLinkProps) {
  const { account, profileLoading } = useAuth();

  if (profileLoading || !account) return null;

  const { affiliate_link_enabled, affiliate_link_label, affiliate_link_url } =
    account;

  if (!isAffiliateLinkVisible(affiliate_link_enabled, affiliate_link_url)) {
    return null;
  }

  const label = resolveAffiliateLabel(affiliate_link_label);
  const url = affiliate_link_url!.trim();

  return (
    <p className={cn("text-[10px] text-slate-600", className)}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-slate-500 underline-offset-2 hover:text-slate-400 hover:underline"
      >
        {label}
      </a>
    </p>
  );
}
