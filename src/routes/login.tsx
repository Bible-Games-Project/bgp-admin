import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Terminal, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { checkAccessGate } from "@/lib/auth-gate";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — bgp console" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const result = await checkAccessGate();
      if ("redirect" in result) {
        if (result.redirect !== "/login") {
          navigate({ to: result.redirect, replace: true });
        }
      } else {
        navigate({ to: "/dashboard", replace: true });
      }
    })();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const result = await checkAccessGate();
      if ("redirect" in result) {
        if (result.redirect === "/forbidden") {
          toast.error("Account not authorized");
          setLoading(false);
        }
        navigate({ to: result.redirect, replace: true });
        // keep loading=true so the overlay stays until the next route mounts
      } else {
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative">
      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="label-mono text-xs text-muted-foreground">Signing in…</span>
        </div>
      )}
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="font-display font-semibold text-sm">bgp / console</span>
        </div>

        <h1 className="text-2xl font-display font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Restricted access. Admins only.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="label-mono">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-card border-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="label-mono">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-card border-border"
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
