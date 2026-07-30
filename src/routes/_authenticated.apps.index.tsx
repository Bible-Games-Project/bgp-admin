import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Boxes, Github, ImageIcon, ExternalLink } from "lucide-react";
import { listApps, createApp, createAppWithRepo } from "@/lib/apps.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AppForm, emptyAppForm } from "@/components/AppForm";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/apps/")({
  component: AppsPage,
});

function AppsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listApps);
  const createFn = useServerFn(createApp);
  const createAppWithRepoFn = useServerFn(createAppWithRepo);
  const [open, setOpen] = useState(false);

  const q = useQuery({ queryKey: ["apps"], queryFn: () => listFn() });

  const createM = useMutation({
    mutationFn: (data: any) => createFn({ data }),
    onSuccess: () => {
      toast.success("App created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 8000 }),
  });

  const createWithRepoM = useMutation({
    mutationFn: (v: any) =>
      createAppWithRepoFn({
        data: {
          ...v,
          repoName: v.github_repo,
          notes: v.notes || null,
          bundle_id: v.bundle_id || null,
          revenuecat_app_id: v.revenuecat_app_id || null,
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

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="label-mono">registry</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Apps</h1>
        </div>
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
              submitting={createWithRepoM.isPending || createM.isPending}
              submitLabel="Create app"
              showCreateRepoOption
              onSubmit={(v, meta) =>
                meta.createRepo
                  ? createWithRepoM.mutate(v)
                  : createM.mutate({
                      ...v,
                      notes: v.notes || null,
                      bundle_id: v.bundle_id || null,
                      revenuecat_app_id: v.revenuecat_app_id || null,
                    })
              }
              onCancel={() => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
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

      <div className="grid gap-3">
        {q.data?.apps.map((a) => (
          <Link
            key={a.id}
            to="/apps/$id"
            params={{ id: a.id }}
            className="rounded-md border border-border bg-card p-4 hover:bg-accent/40 transition-colors flex items-center gap-4"
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
                <span className="text-[10px] font-mono uppercase text-muted-foreground border border-border rounded px-1.5 py-0.5">
                  {a.slug}
                </span>
                {!a.is_active && (
                  <span className="text-[10px] font-mono uppercase text-destructive border border-destructive/40 rounded px-1.5 py-0.5">
                    disabled
                  </span>
                )}
              </div>
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
                <a
                  href={`https://${a.github_repo}.pages.dev`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground/70 hover:text-foreground hover:underline"
                >
                  {a.github_repo}.pages.dev
                </a>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
