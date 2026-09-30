import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { ReviewsView, type ReviewsApp } from "@/components/ReviewsView";
import { appStoreIds, isOnAnyStore } from "@/lib/app-kind";
import { listApps } from "@/lib/apps.functions";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";

export const Route = createFileRoute("/_authenticated/reviews")({
  // ?app= picks one game, e.g. from the Reviews button on a game's page. Home's "Reply"
  // button also asks for the reviews waiting for a reply (?waiting=1), the bad ones
  // first (?sentiment=negative).
  validateSearch: (
    search: Record<string, unknown>,
  ): { app?: string; waiting?: "1"; sentiment?: "positive" | "neutral" | "negative" } => ({
    ...(typeof search.app === "string" ? { app: search.app } : {}),
    ...(search.waiting === "1" || search.waiting === 1 ? { waiting: "1" as const } : {}),
    ...(search.sentiment === "positive" ||
    search.sentiment === "neutral" ||
    search.sentiment === "negative"
      ? { sentiment: search.sentiment }
      : {}),
  }),
  component: ReviewsPage,
});

function ReviewsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const adminFn = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const listAppsFn = useServerFn(listApps);
  const appsQ = useQuery({
    queryKey: ["apps"],
    queryFn: () => listAppsFn(),
    enabled: !!adminQ.data?.isAdmin,
  });

  if (adminQ.isLoading || appsQ.isLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!adminQ.data?.isAdmin) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-xl font-display font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your account is not authorized to view reviews.
        </p>
      </div>
    );
  }
  if (appsQ.error) {
    return <div className="p-8 text-sm text-destructive">{(appsQ.error as Error).message}</div>;
  }

  const apps: ReviewsApp[] = (appsQ.data?.apps ?? [])
    .map((a) => ({ id: a.id, name: a.name, ids: appStoreIds(a) }))
    .filter((a) => isOnAnyStore(a.ids))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto w-full space-y-6">
      <div>
        <span className="label-mono">players</span>
        <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Reviews</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What players say about every game on the App Store, Google Play and Steam, read live from
          the stores. Replies to App Store and Google Play reviews are sent from here; Steam replies
          are written on Steam.
        </p>
      </div>
      <ReviewsView
        apps={apps}
        // A game that is gone, or not on any store, is not in the list: show them all.
        appFilter={apps.some((a) => a.id === search.app) ? search.app! : "all"}
        onAppFilterChange={(id) =>
          navigate({ search: id === "all" ? {} : { app: id }, replace: true })
        }
        initialSentiment={search.sentiment ?? "all"}
        initialWaitingOnly={search.waiting === "1"}
      />
    </div>
  );
}
