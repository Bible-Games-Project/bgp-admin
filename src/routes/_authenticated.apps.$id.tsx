import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Trash2, ExternalLink } from "lucide-react";
import { getApp, updateApp, deleteApp } from "@/lib/apps.functions";
import { Button } from "@/components/ui/button";
import { AppForm, type AppFormValues } from "@/components/AppForm";
import { AppAssetUpload } from "@/components/AppAssetUpload";
import { AppEnvironmentEditor } from "@/components/AppEnvironmentEditor";
import { AppSetupTab } from "@/components/AppSetupTab";
import { AppAddonsTab } from "@/components/AppAddonsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/apps/$id")({
  component: AppDetailPage,
});

function AppDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getApp);
  const updateFn = useServerFn(updateApp);
  const deleteFn = useServerFn(deleteApp);

  const q = useQuery({
    queryKey: ["app", id],
    queryFn: () => getFn({ data: { id } }),
  });

  const updateM = useMutation({
    mutationFn: (patch: any) => updateFn({ data: { id, patch } }),
    onSuccess: (result) => {
      if (result.warning) toast.warning(result.warning, { duration: 12000 });
      const sync = result.nameSync;
      if (sync?.committed) {
        toast.success("Name saved — commit pushed to the app repo", {
          description: `The new name was committed to ${sync.repo}. Publish a new build for players to see it on their device.`,
          duration: 12000,
        });
      } else if (sync && !result.warning) {
        toast.success("Name saved", {
          description:
            "The repo has no Capacitor files yet, so nothing was committed — the name will be applied when you run Capacitor setup.",
          duration: 10000,
        });
      } else {
        toast.success("Saved");
      }
      qc.invalidateQueries({ queryKey: ["app", id] });
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteM = useMutation({
    mutationFn: () => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("App deleted");
      qc.invalidateQueries({ queryKey: ["apps"] });
      navigate({ to: "/apps" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (q.error) {
    return <div className="p-8 text-sm text-destructive">{(q.error as Error).message}</div>;
  }
  const app = q.data!.app;

  const initial: AppFormValues = {
    name: app.name,
    github_owner: app.github_owner,
    github_repo: app.github_repo,
    default_ref: app.default_ref,
    bundle_id: (app as any).bundle_id ?? "",
    revenuecat_app_id: (app as any).revenuecat_app_id ?? "",
    notes: app.notes ?? "",
    is_active: app.is_active,
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto w-full">
      <button
        onClick={() => navigate({ to: "/apps" })}
        className="text-xs text-muted-foreground hover:text-foreground font-mono inline-flex items-center gap-1 mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> apps
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="label-mono">app</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">{app.name}</h1>
          <p className="text-xs text-muted-foreground font-mono mt-1 flex items-center gap-3 flex-wrap">
            <span className="break-all">
              {app.github_owner}/{app.github_repo}
            </span>
            <a
              href={`https://github.com/${app.github_owner}/${app.github_repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              GitHub <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={`https://bgp-${app.github_repo}.pages.dev`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              Cloudflare preview <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive gap-2"
          onClick={() => {
            if (confirm(`Delete app "${app.name}"? This cannot be undone.`)) deleteM.mutate();
          }}
          disabled={deleteM.isPending}
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </div>

      <Tabs defaultValue="general" className="w-full mb-6">
        {/* justify-start + internal scroll: on narrow screens the strip pans
            within itself instead of overflowing the page */}
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="addons">Addons</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <AppForm
            initial={initial}
            submitting={updateM.isPending}
            submitLabel="Save changes"
            onSubmit={(v) =>
              updateM.mutate({
                ...v,
                notes: v.notes || null,
                bundle_id: v.bundle_id || null,
                revenuecat_app_id: v.revenuecat_app_id || null,
              })
            }
          />
        </TabsContent>

        <TabsContent value="branding">
          <div className="space-y-8">
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold mb-2">App Icon</h2>
                <p className="text-sm text-muted-foreground">
                  Upload a square icon image to generate all required iOS and Android icon sizes.
                  Optionally provide a dark mode variant for adaptive theming.
                </p>
              </div>
              <AppAssetUpload
                type="icon"
                appId={id}
                onSuccess={() => {
                  qc.invalidateQueries({ queryKey: ["app", id] });
                }}
              />
            </div>

            <Separator />

            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold mb-2">Splash Screen</h2>
                <p className="text-sm text-muted-foreground">
                  Upload a square splash screen image to generate all required sizes for iOS and
                  Android. Choose background colors for light and dark modes.
                </p>
              </div>
              <AppAssetUpload
                type="splash"
                appId={id}
                onSuccess={() => {
                  qc.invalidateQueries({ queryKey: ["app", id] });
                }}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="environment">
          <AppEnvironmentEditor
            appId={id}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["app", id] });
            }}
          />
        </TabsContent>

        <TabsContent value="setup">
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">App Setup</h2>
              <p className="text-sm text-muted-foreground">
                One-time steps to wire up a new app repo. Run these in order the first time, then
                configure the repository secrets manually.
              </p>
            </div>
            <AppSetupTab
              appId={id}
              bundleId={(app as any).bundle_id ?? null}
              appName={app.name}
              githubOwner={(app as any).github_owner ?? null}
              githubRepo={(app as any).github_repo ?? null}
              onSuccess={() => {
                qc.invalidateQueries({ queryKey: ["app", id] });
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="addons">
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">Addons</h2>
              <p className="text-sm text-muted-foreground">
                Optional features you can add to the app with one click. Each addon follows the same
                pattern: do the console steps, paste the keys, press Install, then send the final
                prompt to Lovable to wire it into the game.
              </p>
            </div>
            <AppAddonsTab
              appId={id}
              onSuccess={() => {
                qc.invalidateQueries({ queryKey: ["app", id] });
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
