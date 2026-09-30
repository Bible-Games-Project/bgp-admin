import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Trash2, ExternalLink, Star, DollarSign, Download } from "lucide-react";
import { getApp, updateApp, deleteApp } from "@/lib/apps.functions";
import { checkPreviewDeployWorkflow } from "@/lib/capacitor.functions";
import { Button } from "@/components/ui/button";
import { AppForm, parseSteamAppId, type AppFormValues } from "@/components/AppForm";
import { appStoreIds, isOnAnyStore, isWebGame, playStoreUrl, steamStoreUrl } from "@/lib/app-kind";
import { AppAssetUpload } from "@/components/AppAssetUpload";
import { AppEnvironmentEditor } from "@/components/AppEnvironmentEditor";
import { AppSetupTab } from "@/components/AppSetupTab";
import { AppAddonsTab } from "@/components/AppAddonsTab";
import { StoreListingTab } from "@/components/StoreListingTab";
import { AppDeployTab } from "@/components/AppDeployTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const TABS = ["deploy", "general", "branding", "store", "environment", "setup", "addons"] as const;
type Tab = (typeof TABS)[number];
/** The console doesn't build a game that isn't a web game, so only these apply to it. */
const EXTERNAL_TABS: readonly Tab[] = ["general", "store"];

export const Route = createFileRoute("/_authenticated/apps/$id")({
  // ?tab=setup opens that tab directly, e.g. from a cell of the setup overview.
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: AppDetailPage,
});

function AppDetailPage() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getApp);
  const updateFn = useServerFn(updateApp);
  const deleteFn = useServerFn(deleteApp);
  const checkPreviewFn = useServerFn(checkPreviewDeployWorkflow);

  const q = useQuery({
    queryKey: ["app", id],
    queryFn: () => getFn({ data: { id } }),
  });

  // Shares its cache with the Setup tab, so turning the preview off there hides the link.
  const previewQ = useQuery({
    queryKey: ["preview-deploy-workflow", id],
    queryFn: () => checkPreviewFn({ data: { appId: id } }),
    enabled: !!q.data && isWebGame(q.data.app),
  });
  const previewUrl = previewQ.data?.previewUrl;

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
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
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
  const external = !isWebGame(app);
  const storeIds = appStoreIds(app);
  // The Revenue page knows a game by its App Store bundle ID, or else its Play package name.
  const revenueKey = storeIds.ios ?? storeIds.android;
  const activeTab: Tab = tab && (!external || EXTERNAL_TABS.includes(tab)) ? tab : "general";

  const initial: AppFormValues = {
    name: app.name,
    github_owner: app.github_owner ?? "",
    github_repo: app.github_repo ?? "",
    default_ref: app.default_ref,
    bundle_id: app.bundle_id ?? "",
    android_package_name: app.android_package_name ?? "",
    steam_app_id: app.steam_app_id?.toString() ?? "",
    notes: app.notes ?? "",
    is_active: app.is_active,
  };

  // A web game keeps its repo and ships to Google Play under its bundle ID; any
  // other game only has store IDs (see src/lib/app-kind.ts).
  const patchFrom = (v: AppFormValues) => {
    const steam_app_id = parseSteamAppId(v.steam_app_id).value;
    const notes = v.notes || null;
    if (external) {
      return {
        name: v.name,
        bundle_id: v.bundle_id.trim() || null,
        android_package_name: v.android_package_name.trim() || null,
        steam_app_id,
        notes,
        is_active: v.is_active,
      };
    }
    const { android_package_name: _unused, ...web } = v;
    return {
      ...web,
      steam_app_id,
      notes,
      bundle_id: v.bundle_id || null,
    };
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto w-full">
      <button
        onClick={() => navigate({ to: "/apps" })}
        className="text-xs text-muted-foreground hover:text-foreground font-mono inline-flex items-center gap-1 mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> apps
      </button>

      <div className="flex items-center justify-between gap-4 mb-6">
        {/* The icon next to the name, so it is plain which game is about to be deployed. */}
        <div className="flex items-center gap-4 min-w-0">
          {app.icon_data_url && (
            <img
              src={app.icon_data_url}
              alt={`${app.name} icon`}
              className="h-14 w-14 rounded-xl border border-border object-cover shrink-0"
            />
          )}
          <div className="min-w-0">
            <span className="label-mono">app</span>
            <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">{app.name}</h1>
            {external ? (
              <>
                <p className="text-xs text-muted-foreground font-mono mt-1 flex items-center gap-3 flex-wrap">
                  <span>not a web game</span>
                  {storeIds.ios && <span className="break-all">App Store {storeIds.ios}</span>}
                  {storeIds.android && (
                    <a
                      href={playStoreUrl(storeIds.android)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                    >
                      Google Play <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {storeIds.steam && (
                    <a
                      href={steamStoreUrl(storeIds.steam)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                    >
                      Steam <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  New versions of it are built and uploaded with its own tools (Unity, Xcode, Play
                  Console, Steamworks), so it has no Deploy tab here.
                </p>
              </>
            ) : (
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
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    Cloudflare preview <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {storeIds.steam && (
                  <a
                    href={steamStoreUrl(storeIds.steam)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    Steam <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </p>
            )}
          </div>
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

      {/* The Reviews, Revenue and Downloads pages cover every game; these open them on
          this one. */}
      {(isOnAnyStore(storeIds) || revenueKey) && (
        <div className="flex flex-wrap gap-2 -mt-2 mb-6">
          {isOnAnyStore(storeIds) && (
            <Button asChild size="sm" variant="outline" className="gap-2">
              <Link to="/reviews" search={{ app: id }}>
                <Star className="h-4 w-4" /> Reviews
              </Link>
            </Button>
          )}
          {revenueKey && (
            <Button asChild size="sm" variant="outline" className="gap-2">
              <Link to="/revenue" search={{ preset: "12m", app: revenueKey, store: null }}>
                <DollarSign className="h-4 w-4" /> Revenue
              </Link>
            </Button>
          )}
          {(storeIds.ios || storeIds.android) && (
            <Button asChild size="sm" variant="outline" className="gap-2">
              <Link to="/downloads" search={{ preset: "12m", app: id, store: null }}>
                <Download className="h-4 w-4" /> Downloads
              </Link>
            </Button>
          )}
        </div>
      )}

      {/* The open tab lives in ?tab=, so links like "Store tab" work from anywhere,
          including from another tab of this same page. */}
      <Tabs
        value={activeTab}
        onValueChange={(t) =>
          navigate({ to: "/apps/$id", params: { id }, search: { tab: t as Tab }, replace: true })
        }
        className="w-full mb-6"
      >
        {/* justify-start + internal scroll: on narrow screens the strip pans
            within itself instead of overflowing the page */}
        <TabsList className="max-w-full justify-start overflow-x-auto">
          {!external && <TabsTrigger value="deploy">Deploy</TabsTrigger>}
          <TabsTrigger value="general">General</TabsTrigger>
          {!external && <TabsTrigger value="branding">Branding</TabsTrigger>}
          <TabsTrigger value="store">Store</TabsTrigger>
          {!external && <TabsTrigger value="environment">Environment</TabsTrigger>}
          {!external && <TabsTrigger value="setup">Setup</TabsTrigger>}
          {!external && <TabsTrigger value="addons">Addons</TabsTrigger>}
        </TabsList>

        {isWebGame(app) && (
          <TabsContent value="deploy">
            <AppDeployTab app={app} />
          </TabsContent>
        )}

        <TabsContent value="general">
          <AppForm
            initial={initial}
            external={external}
            submitting={updateM.isPending}
            submitLabel="Save changes"
            onSubmit={(v) => updateM.mutate(patchFrom(v))}
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

        <TabsContent value="store">
          <StoreListingTab appId={id} storeIds={storeIds} external={external} />
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
