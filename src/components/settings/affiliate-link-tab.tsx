"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Link2, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_AFFILIATE_LABEL,
  MAX_AFFILIATE_LABEL_LEN,
  MAX_AFFILIATE_URL_LEN,
  resolveAffiliateLabel,
  validateAffiliateUrl,
} from "@/lib/affiliate/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export function AffiliateLinkTab() {
  const supabase = createClient();
  const {
    account,
    accountId,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [enabled, setEnabled] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!account) return;
    setEnabled(account.affiliate_link_enabled);
    setLabel(account.affiliate_link_label ?? "");
    setUrl(account.affiliate_link_url ?? "");
  }, [account]);

  const dirty =
    !!account &&
    (enabled !== account.affiliate_link_enabled ||
      label.trim() !== (account.affiliate_link_label ?? "").trim() ||
      url.trim() !== (account.affiliate_link_url ?? "").trim());

  async function handleSave() {
    if (!accountId || !dirty || !canEditSettings) return;

    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();

    if (enabled) {
      const urlError = validateAffiliateUrl(trimmedUrl);
      if (urlError) {
        toast.error(urlError);
        return;
      }
    }

    if (trimmedLabel.length > MAX_AFFILIATE_LABEL_LEN) {
      toast.error(
        `Label must be ${MAX_AFFILIATE_LABEL_LEN} characters or fewer`,
      );
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        affiliate_link_enabled: enabled,
        affiliate_link_label: trimmedLabel || null,
        affiliate_link_url: enabled ? trimmedUrl : trimmedUrl || null,
      })
      .eq("id", accountId);

    if (error) {
      toast.error("Failed to save affiliate link settings");
      setSaving(false);
      return;
    }

    await refreshProfile();
    setSaving(false);
    toast.success("Affiliate link settings saved");
  }

  const previewLabel = resolveAffiliateLabel(label);

  return (
    <section className="mt-4 space-y-4">
      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Link2 className="size-4 text-primary" />
            Affiliate link
          </CardTitle>
          <CardDescription className="text-slate-400">
            Show a partner or affiliate link under the message composer in
            every Inbox chat. All teammates on this account see the same link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3">
            <div className="space-y-0.5">
              <Label htmlFor="affiliate-enabled" className="text-slate-200">
                Show in Inbox
              </Label>
              <p className="text-xs text-slate-500">
                Visible to agents and viewers while chatting
              </p>
            </div>
            <Switch
              id="affiliate-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canEditSettings || profileLoading}
            />
          </div>

          <div className="grid gap-4 sm:max-w-lg">
            <div className="grid gap-2">
              <Label htmlFor="affiliate-label" className="text-slate-300">
                Link label
              </Label>
              <Input
                id="affiliate-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={DEFAULT_AFFILIATE_LABEL}
                maxLength={MAX_AFFILIATE_LABEL_LEN}
                disabled={!canEditSettings || profileLoading}
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-500">
                Optional. Defaults to &quot;{DEFAULT_AFFILIATE_LABEL}&quot; if
                left empty.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="affiliate-url" className="text-slate-300">
                URL
              </Label>
              <Input
                id="affiliate-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/partner-offer"
                maxLength={MAX_AFFILIATE_URL_LEN}
                disabled={!canEditSettings || profileLoading}
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
              {enabled && (
                <p className="text-xs text-slate-500">
                  Must be a valid https:// URL when enabled.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/50 px-4 py-3">
            <p className="mb-1 text-xs font-medium text-slate-400">Preview</p>
            <p className="text-[10px] text-slate-600">
              Type &apos;/&apos; for quick replies
            </p>
            {enabled && url.trim() ? (
              <p className="mt-0.5 text-[10px] text-slate-600">
                <span className="inline-flex items-center gap-1 text-slate-500">
                  {previewLabel}
                  <ExternalLink className="size-2.5 opacity-60" />
                </span>
              </p>
            ) : (
              <p className="mt-0.5 text-[10px] italic text-slate-600">
                Link hidden until enabled with a valid URL
              </p>
            )}
          </div>

          {!canEditSettings && (
            <p className="text-xs text-slate-500">
              Only account admins can change affiliate link settings.
            </p>
          )}

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
