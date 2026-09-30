import { createClient } from "@/lib/supabase/server";

type Role = "viewer" | "agent" | "admin" | "owner";

/** Signed-in account member with at least `minRole`, or an HTTP error. */
export async function requireMember(minRole: Role) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { error: "Unauthorized", status: 401 } as const;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const accountId = profile?.account_id as string | undefined;
  if (!accountId) return { error: "Your profile is not linked to an account.", status: 403 } as const;

  const { data: allowed } = await supabase.rpc("is_account_member", {
    target_account_id: accountId,
    min_role: minRole,
  });
  if (allowed !== true) return { error: "Forbidden", status: 403 } as const;

  return { supabase, user, accountId } as const;
}
