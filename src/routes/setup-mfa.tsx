import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldPlus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/setup-mfa")({
  head: () => ({ meta: [{ title: "Set up 2FA — bgp console" }] }),
  component: SetupMfaPage,
});

function SetupMfaPage() {
  const navigate = useNavigate();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate({ to: "/login", replace: true });
        return;
      }
      // If a verified factor already exists, skip enrolment.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      if ((factors?.totp ?? []).some((f) => f.status === "verified")) {
        navigate({ to: "/mfa-challenge", replace: true });
        return;
      }
      // Clean up any stale unverified factors before enrolling a fresh one.
      for (const f of factors?.totp ?? []) {
        if (f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `bgp-console-${Date.now()}`,
      });
      if (error) {
        toast.error(error.message);
        setBootstrapping(false);
        return;
      }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setBootstrapping(false);
    })();
  }, [navigate]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (error) throw error;
      toast.success("2FA enabled");
      navigate({ to: "/dashboard", replace: true });
    } catch (err: any) {
      toast.error(err.message ?? "Invalid code");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    if (factorId) {
      await supabase.auth.mfa.unenroll({ factorId });
    }
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  return (
    <div className="h-dvh overflow-y-auto flex bg-background px-4 py-12">
      <div className="w-full max-w-sm m-auto">
        <div className="flex items-center gap-2 mb-8">
          <ShieldPlus className="h-4 w-4 text-primary" />
          <span className="font-display font-semibold text-sm">bgp / enable 2fa</span>
        </div>
        <h1 className="text-2xl font-display font-semibold tracking-tight">Set up two-factor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Two-factor is required. Scan the QR with an authenticator app (1Password, Authy, Google
          Authenticator) and enter the 6-digit code.
        </p>

        {bootstrapping ? (
          <div className="mt-8 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : qr ? (
          <>
            <div className="mt-8 p-4 bg-card border border-border rounded-md flex items-center justify-center">
              <img src={qr} alt="2FA QR code" className="w-48 h-48" />
            </div>
            {secret && (
              <div className="mt-3">
                <p className="label-mono text-xs text-muted-foreground mb-1">
                  Or enter this secret manually
                </p>
                <code className="block text-xs font-mono break-all bg-muted/40 border border-border rounded px-2 py-1.5">
                  {secret}
                </code>
              </div>
            )}

            <form onSubmit={verify} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code" className="label-mono">
                  Verification code
                </Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  minLength={6}
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="bg-card border-border text-center tracking-[0.5em] font-mono text-lg"
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Verify and enable
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={cancel}>
                Cancel and sign out
              </Button>
            </form>
          </>
        ) : (
          <p className="mt-8 text-sm text-destructive">
            Failed to start enrolment. Try signing in again.
          </p>
        )}
      </div>
    </div>
  );
}
