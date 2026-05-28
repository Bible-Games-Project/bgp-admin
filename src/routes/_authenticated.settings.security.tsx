import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Trash2, Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/security")({
  head: () => ({ meta: [{ title: "Security — bgp console" }] }),
  component: SecurityPage,
});

type Factor = {
  id: string;
  friendly_name: string | null;
  status: string;
  created_at: string;
};

function SecurityPage() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) toast.error(error.message);
    setFactors((data?.totp ?? []) as Factor[]);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const remove = async (id: string) => {
    if (factors.filter((f) => f.status === "verified").length <= 1) {
      toast.error("Cannot remove the only 2FA factor. Add another first.");
      return;
    }
    setBusyId(id);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) toast.error(error.message);
    else toast.success("Factor removed");
    setBusyId(null);
    refresh();
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold tracking-tight">
          Security
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your two-factor authentication devices.
        </p>
      </div>

      <div className="border border-border rounded-md bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="label-mono text-sm">Authenticator apps</span>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/setup-mfa">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : factors.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No factors enrolled.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {factors.map((f) => (
              <li
                key={f.id}
                className="p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {f.friendly_name ?? "Authenticator"}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {f.status} ·{" "}
                    {new Date(f.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === f.id}
                  onClick={() => remove(f.id)}
                >
                  {busyId === f.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
