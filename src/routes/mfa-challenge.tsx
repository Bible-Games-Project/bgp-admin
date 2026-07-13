import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/mfa-challenge")({
  head: () => ({ meta: [{ title: "Verify — bgp console" }] }),
  component: MfaChallengePage,
});

function MfaChallengePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = (factors?.totp ?? []).find((f) => f.status === "verified");
      if (!totp) {
        navigate({ to: "/setup-mfa", replace: true });
        return;
      }
      setFactorId(totp.id);
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        navigate({ to: "/dashboard", replace: true });
      }
    })();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      });
      if (error) throw error;
      navigate({ to: "/dashboard", replace: true });
    } catch (err: any) {
      toast.error(err.message ?? "Invalid code");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  return (
    <div className="h-dvh overflow-y-auto flex bg-background px-4">
      <div className="w-full max-w-sm m-auto">
        <div className="flex items-center gap-2 mb-8">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="font-display font-semibold text-sm">bgp / two-factor</span>
        </div>
        <h1 className="text-2xl font-display font-semibold tracking-tight">Enter your code</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Open your authenticator app and enter the 6-digit code.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="code" className="label-mono">
              Code
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
            Verify
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={cancel}>
            Cancel and sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
