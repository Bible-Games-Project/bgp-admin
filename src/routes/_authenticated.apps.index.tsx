import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Boxes,
  Github,
  GripVertical,
  ImageIcon,
  ListChecks,
  Rocket,
  Store,
} from "lucide-react";
import {
  listApps,
  createApp,
  createAppWithRepo,
  createExternalGame,
  reorderApps,
} from "@/lib/apps.functions";
import { moveApp, withListOrder } from "@/lib/app-order";
import { cn } from "@/lib/utils";
import { checkPreviewDeployWorkflow } from "@/lib/capacitor.functions";
import { appStoreIds, isWebGame, playStoreUrl, steamStoreUrl } from "@/lib/app-kind";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AppForm, emptyAppForm, parseSteamAppId } from "@/components/AppForm";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/apps/")({
  component: AppsPage,
});

function AppsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listApps);
  const createFn = useServerFn(createApp);
  const createAppWithRepoFn = useServerFn(createAppWithRepo);
  const createExternalFn = useServerFn(createExternalGame);
  const checkPreviewFn = useServerFn(checkPreviewDeployWorkflow);
  const reorderFn = useServerFn(reorderApps);
  const [open, setOpen] = useState(false);

  const q = useQuery({ queryKey: ["apps"], queryFn: () => listFn() });

  // Cards are moved by their grip: with the mouse after a few pixels (so a click on
  // the grip does nothing), by touch, or with the keyboard (space, arrows, space).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderM = useMutation({
    mutationFn: (ids: string[]) => reorderFn({ data: { ids } }),
    onError: (e: Error) => {
      toast.error(`The new order could not be saved: ${e.message}`, { duration: 12000 });
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });

  // The list shows the new order at once; the save happens behind it.
  function onDragEnd({ active, over }: DragEndEvent) {
    const current = q.data?.apps;
    if (!current || !over) return;
    const next = moveApp(current, String(active.id), String(over.id));
    if (next === current) return;
    void qc.cancelQueries({ queryKey: ["apps"] });
    qc.setQueryData(["apps"], { apps: withListOrder(next) });
    reorderM.mutate(next.map((a) => a.id));
  }

  // A game only has a Cloudflare preview once its repo runs preview-deploy.yml, so each
  // one is checked before its link is shown. Same cache as the Setup tab and overview.
  const webGames = (q.data?.apps ?? []).filter(isWebGame);
  const previews = useQueries({
    queries: webGames.map((a) => ({
      queryKey: ["preview-deploy-workflow", a.id],
      queryFn: () => checkPreviewFn({ data: { appId: a.id } }),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const previewUrl = new Map(webGames.map((a, i) => [a.id, previews[i]?.data?.previewUrl]));

  const createM = useMutation({
    mutationFn: (data: any) => createFn({ data }),
    onSuccess: (result) => {
      if (result?.warning) toast.warning(result.warning, { duration: 12000 });
      toast.success("App created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const createWithRepoM = useMutation({
    mutationFn: (v: any) =>
      createAppWithRepoFn({
        data: {
          ...v,
          repoName: v.github_repo,
          notes: v.notes || null,
          bundle_id: v.bundle_id || null,
        },
      }),
    onSuccess: (result) => {
      if (result.warning) toast.warning(result.warning, { duration: 12000 });
      toast.success("App created with new GitHub repo");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 12000 }),
  });

  const createExternalM = useMutation({
    mutationFn: (v: any) =>
      createExternalFn({
        data: {
          name: v.name.trim(),
          bundle_id: v.bundle_id.trim() || null,
          android_package_name: v.android_package_name.trim() || null,
          steam_app_id: parseSteamAppId(v.steam_app_id).value,
          notes: v.notes || null,
          is_active: v.is_active,
        },
      }),
    onSuccess: (result) => {
      if (result.warning) toast.warning(result.warning, { duration: 15000 });
      toast.success(`${result.app.name} added`, {
        description: "Its store pages are in its Store tab.",
      });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="label-mono">registry</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Apps</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link to="/apps/setup">
              <ListChecks className="h-4 w-4" /> Setup overview
            </Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New app
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New app</DialogTitle>
              </DialogHeader>
              <AppForm
                initial={emptyAppForm}
                submitting={
                  createWithRepoM.isPending || createM.isPending || createExternalM.isPending
                }
                submitLabel="Create app"
                showCreateRepoOption
                onSubmit={(v, meta) =>
                  meta.mode === "external"
                    ? createExternalM.mutate(v)
                    : meta.mode === "create"
                      ? createWithRepoM.mutate(v)
                      : createM.mutate({
                          ...v,
                          notes: v.notes || null,
                          bundle_id: v.bundle_id || null,
                        })
                }
                onCancel={() => setOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.data?.apps.length === 0 && (
        <div className="rounded-md border border-border bg-card p-8 text-center">
          <Boxes className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No apps yet. Create the first one to start deploying.
          </p>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={(q.data?.apps ?? []).map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="grid gap-3">
            {q.data?.apps.map((a) => (
              <AppCard key={a.id} app={a} previewUrl={previewUrl.get(a.id)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

type ListedApp = Awaited<ReturnType<typeof listApps>>["apps"][number];

/** One game in the list, moved up or down by dragging its grip. */
function AppCard({ app: a, previewUrl }: { app: ListedApp; previewUrl?: string | null }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: a.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "rounded-md border border-border bg-card hover:bg-accent/40 transition-colors flex flex-col sm:flex-row sm:items-center",
        isDragging && "relative z-10 shadow-lg ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center min-w-0 flex-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Move ${a.name} up or down the list`}
          title="Drag to change the order"
          className="self-stretch pl-2 pr-1 flex items-center rounded-l-md text-muted-foreground/50 hover:text-foreground cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Link
          to="/apps/$id"
          params={{ id: a.id }}
          className="py-4 pr-4 pl-2 flex items-center gap-4 min-w-0 flex-1"
        >
          <div className="h-10 w-10 rounded-md border border-border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
            {a.icon_data_url ? (
              <img
                src={a.icon_data_url}
                alt={`${a.name} icon`}
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-display font-semibold">{a.name}</span>
              {!a.is_active && (
                <span className="text-[10px] font-mono uppercase text-destructive border border-destructive/40 rounded px-1.5 py-0.5">
                  disabled
                </span>
              )}
            </div>
            {isWebGame(a) ? (
              <div className="text-xs text-muted-foreground font-mono mt-1 flex items-center gap-1.5 flex-wrap">
                <Github className="h-3 w-3 shrink-0" />
                <a
                  href={`https://github.com/${a.github_owner}/${a.github_repo}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="hover:text-foreground hover:underline"
                >
                  {a.github_owner}/{a.github_repo}
                </a>
                <span>· {a.default_ref}</span>
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground/70 hover:text-foreground hover:underline"
                  >
                    bgp-{a.github_repo}.pages.dev
                  </a>
                )}
                {a.steam_app_id != null && <SteamLink appId={a.steam_app_id} />}
              </div>
            ) : (
              <OtherEngineStores app={a} />
            )}
          </div>
        </Link>
      </div>
      {/* Deploying starts from the game's own card, next to its icon and name, so
              there is no doubt about which game is being sent to the stores. */}
      {isWebGame(a) && a.is_active && (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="gap-2 shrink-0 self-start mx-4 mb-4 sm:self-auto sm:ml-0 sm:mb-0"
        >
          <Link to="/apps/$id" params={{ id: a.id }} search={{ tab: "deploy" }}>
            <Rocket className="h-4 w-4" /> Deploy
          </Link>
        </Button>
      )}
    </div>
  );
}

/** Where a game that isn't a web game is published, in place of its repo. */
function OtherEngineStores({ app }: { app: Parameters<typeof appStoreIds>[0] }) {
  const ids = appStoreIds(app);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="text-xs text-muted-foreground font-mono mt-1 flex items-center gap-1.5 flex-wrap">
      <Store className="h-3 w-3 shrink-0" />
      <span>not a web game</span>
      {ids.ios && <span>· App Store {ids.ios}</span>}
      {ids.android && (
        <a
          href={playStoreUrl(ids.android)}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          className="hover:text-foreground hover:underline"
        >
          · Google Play {ids.android}
        </a>
      )}
      {ids.steam && <SteamLink appId={ids.steam} />}
    </div>
  );
}

function SteamLink({ appId }: { appId: number }) {
  return (
    <a
      href={steamStoreUrl(appId)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="hover:text-foreground hover:underline"
    >
      · Steam {appId}
    </a>
  );
}
