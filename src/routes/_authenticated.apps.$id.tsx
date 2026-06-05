import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Trash2 } from "lucide-react";
import { getApp, updateApp, deleteApp } from "@/lib/apps.functions";
import { Button } from "@/components/ui/button";
import { AppForm, type AppFormValues } from "@/components/AppForm";
import { AppAssetUpload } from "@/components/AppAssetUpload";
import { AppEnvironmentEditor } from "@/components/AppEnvironmentEditor";
import { AppNameEditor } from "@/components/AppNameEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    onSuccess: () => {
      toast.success("Saved");
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
    slug: app.slug,
    name: app.name,
    github_owner: app.github_owner,
    github_repo: app.github_repo,
    default_ref: app.default_ref,
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
          <p className="text-xs text-muted-foreground font-mono mt-1">
            {app.github_owner}/{app.github_repo}
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
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="name">App Name</TabsTrigger>
          <TabsTrigger value="icon">Icon</TabsTrigger>
          <TabsTrigger value="splash">Splash</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
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
              })
            }
          />
        </TabsContent>

        <TabsContent value="name">
          <AppNameEditor
            appId={id}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["app", id] });
            }}
          />
        </TabsContent>

        <TabsContent value="icon">
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
        </TabsContent>

        <TabsContent value="splash">
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold mb-2">Splash Screen</h2>
              <p className="text-sm text-muted-foreground">
                Upload a square splash screen image to generate all required sizes for iOS and Android.
                Choose background colors for light and dark modes.
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
        </TabsContent>

        <TabsContent value="environment">
          <AppEnvironmentEditor
            appId={id}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["app", id] });
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
