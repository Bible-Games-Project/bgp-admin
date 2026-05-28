import { supabase } from "@/integrations/supabase/client";

export type GateResult =
  | { ok: true }
  | { redirect: "/login" | "/setup-mfa" | "/mfa-challenge" | "/forbidden" };

/**
 * Central admin + MFA gate. Used by _authenticated.beforeLoad and by
 * post-login redirect logic.
 */
export async function checkAccessGate(): Promise<GateResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { redirect: "/login" };

  // 1. Must be in admins table.
  const { data: adminRow } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!adminRow) {
    await supabase.auth.signOut();
    return { redirect: "/forbidden" };
  }

  // 2. Must have a verified TOTP factor (mandatory MFA).
  const { data: factors, error: factorsError } =
    await supabase.auth.mfa.listFactors();
  if (factorsError) return { redirect: "/login" };
  const verifiedTotp = (factors?.totp ?? []).find(
    (f) => f.status === "verified",
  );
  if (!verifiedTotp) return { redirect: "/setup-mfa" };

  // 3. Must have stepped up to aal2 in this session.
  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return { redirect: "/mfa-challenge" };

  return { ok: true };
}
