import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Euro,
  ImageIcon,
  Info,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RunFailure } from "@/components/RunFailure";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";
import { formatDay } from "@/lib/expenses";
import {
  type AttentionItem,
  type GameStatus,
  type HomeAction,
  type Severity,
  type UpcomingItem,
  appStoreStateLabel,
} from "@/lib/home";
import { getHome, releaseAppStoreVersion, runChecks } from "@/lib/home.functions";
import { IN_REVIEW_STATES, MONITOR_EVERY_MINUTES, REJECTED_STATES } from "@/lib/monitor";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

// A Check now run stops at its request limit and hands over; a few runs cover every check.
const MAX_CHECK_RUNS = 5;

const fmtEUR = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(n);

function HomePage() {
  const adminFn = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const enabled = !!adminQ.data?.isAdmin;

  const homeFn = useServerFn(getHome);
  // The job runs every 15 minutes; an open page picks up what it found.
  const homeQ = useQuery({
    queryKey: ["home"],
    queryFn: () => homeFn(),
    enabled,
    refetchInterval: 5 * 60 * 1000,
  });

  const queryClient = useQueryClient();
  const runFn = useServerFn(runChecks);
  const check = useMutation({
    mutationFn: async () => {
      const since = new Date().toISOString();
      for (let run = 0; run < MAX_CHECK_RUNS; run++) {
        const { remaining } = await runFn({ data: { since } });
        await queryClient.invalidateQueries({ queryKey: ["home"] });
        if (!remaining) break;
      }
    },
    onError: (e: Error) =>
      toast.error(`Couldn't run the checks: ${e.message}`, { duration: 15000 }),
  });

  // A job that never ran (a new database) or stopped running is made up for on opening
  // the page, once.
  const lastChecked = homeQ.data?.lastChecked ?? null;
  const outdated =
    homeQ.isSuccess &&
    (!lastChecked || Date.now() - Date.parse(lastChecked) > 4 * MONITOR_EVERY_MINUTES * 60_000);
  const [autoChecked, setAutoChecked] = useState(false);
  const { mutate: runCheck } = check;
  useEffect(() => {
    if (outdated && !autoChecked) {
      setAutoChecked(true);
      runCheck();
    }
  }, [outdated, autoChecked, runCheck]);

  const releaseFn = useServerFn(releaseAppStoreVersion);
  const release = useMutation({
    mutationFn: (a: { appId: string; versionId: string }) => releaseFn({ data: a }),
    onSuccess: ({ version }) => {
      toast.success(`Version ${version} is released`, {
        description: "The App Store shows it to players within a few hours.",
      });
      check.mutate();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  if (adminQ.isLoading) {
    return (
      <div className="p-8 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }
  if (!adminQ.data?.isAdmin) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-xl font-display font-semibold">Access denied</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Your account is not authorized to use this console.
        </p>
      </div>
    );
  }

  const data = homeQ.data;
  const firstRun = !lastChecked && check.isPending;
  const notableGames = (data?.games ?? []).filter(
    (game) =>
      (game.appStore && game.appStore.state !== "READY_FOR_SALE") ||
      (game.deploy &&
        (game.deploy.status !== "completed" || game.deploy.conclusion !== "success")) ||
      (game.android && game.android.crashes + game.android.anrs > 0) ||
      game.reviewsThisWeek > 0,
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto w-full space-y-8">
      <div className="space-y-4">
        <div>
          <span className="label-mono">overview</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Home</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What needs you now, what's coming up, and how the games are doing.
          </p>
        </div>
        <CheckBar
          lastChecked={lastChecked}
          checking={check.isPending}
          onCheck={() => check.mutate()}
        />
      </div>

      {homeQ.error && (
        <p className="text-sm text-destructive">Home couldn't be loaded: {homeQ.error.message}</p>
      )}

      {(homeQ.isLoading || firstRun) && (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {firstRun ? "Checking the stores for the first time…" : "Loading…"}
        </div>
      )}

      {data && !firstRun && (
        <>
          <section className="space-y-3">
            <SectionTitle>Needs attention</SectionTitle>
            {data.attention.length === 0 ? (
              <Card>
                <CardContent className="p-5 flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                  <div>
                    <div className="font-medium">All good</div>
                    <div className="text-sm text-muted-foreground">
                      Nothing needs you right now.
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {data.attention.map((item) => (
                  <AttentionCard
                    key={item.id}
                    item={item}
                    icon={item.appId ? data.icons[item.appId] : null}
                    releasing={release.isPending}
                    onRelease={(a) => release.mutate(a)}
                  />
                ))}
              </div>
            )}
          </section>

          {(data.upcoming.length > 0 || data.askForAppleMembership) && (
            <section className="space-y-3">
              <SectionTitle>Coming up</SectionTitle>
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {data.upcoming.map((u) => (
                    <UpcomingRow key={u.id} item={u} />
                  ))}
                  {data.askForAppleMembership && <AppleMembershipRow />}
                </CardContent>
              </Card>
            </section>
          )}

          <section className="space-y-3">
            <SectionTitle>At a glance</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <GlanceCard
                label="Profit this month"
                icon={<Euro className="h-4 w-4" />}
                value={fmtEUR(data.profitability.profit)}
                hint={
                  <>
                    {data.profitability.estimated ? "Estimated · " : ""}
                    Income {fmtEUR(data.profitability.income)} − costs{" "}
                    {fmtEUR(data.profitability.costs)}
                    {data.profitability.missingExchangeRate
                      ? " · Some USD costs lack an exchange rate"
                      : ""}
                    {" · "}
                    <Link
                      to="/revenue"
                      search={{ preset: "month", app: null, store: null }}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Details
                    </Link>
                  </>
                }
              />
              <GlanceCard
                label="This month"
                icon={<Euro className="h-4 w-4" />}
                value={fmtEUR(data.glance.income.thisMonth)}
                hint={
                  <>
                    Last month {fmtEUR(data.glance.income.lastMonth)} ·{" "}
                    <Link
                      to="/revenue"
                      search={{ preset: "month", app: null, store: null }}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Revenue
                    </Link>
                  </>
                }
              />
              <GlanceCard
                label="New reviews this week"
                icon={<Star className="h-4 w-4" />}
                value={String(data.glance.reviews.week)}
                hint={
                  <>
                    {data.glance.reviews.average != null &&
                      `${data.glance.reviews.average.toFixed(1)}★ average · `}
                    {data.glance.reviews.waiting} waiting for a reply ·{" "}
                    <Link
                      to="/reviews"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Reviews
                    </Link>
                  </>
                }
              />
              <GlanceCard
                label="Versions in App Review"
                icon={<ShieldCheck className="h-4 w-4" />}
                value={String(data.glance.inReview.length)}
                hint={
                  data.glance.inReview.length
                    ? data.glance.inReview.map((r) => `${r.name} ${r.version}`).join(", ")
                    : "Nothing waiting for Apple"
                }
              />
              <GlanceCard
                label="Google Play crashes"
                icon={<Bug className="h-4 w-4" />}
                value={
                  data.glance.crashes
                    ? String(data.glance.crashes.crashes + data.glance.crashes.anrs)
                    : "—"
                }
                hint={
                  !data.glance.crashes
                    ? "Not checked yet"
                    : data.glance.crashes.crashes + data.glance.crashes.anrs === 0
                      ? "None in the last 7 days"
                      : `Crashes and freezes in the last 7 days, in ${data.glance.crashes.games} game${data.glance.crashes.games === 1 ? "" : "s"}`
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle>Game highlights</SectionTitle>
            {notableGames.length ? (
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {notableGames.map((g) => (
                    <GameRow key={g.id} game={g} icon={data.icons[g.id]} />
                  ))}
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">No notable updates across the games.</p>
            )}
            <details className="group rounded-md border bg-card">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
                Show all {data.games.length} games
              </summary>
              <div className="border-t divide-y divide-border">
                {data.games.map((g) => (
                  <GameRow key={g.id} game={g} icon={data.icons[g.id]} />
                ))}
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold tracking-tight">{children}</h2>;
}

/** When the checks last ran, how often they do, and a way to run them now. */
function CheckBar({
  lastChecked,
  checking,
  onCheck,
}: {
  lastChecked: string | null;
  checking: boolean;
  onCheck: () => void;
}) {
  // Keeps "… ago" true while the page stays open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-x-3 gap-y-2 flex-wrap rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <span className="flex-1 min-w-[200px]">
        {checking
          ? "Checking the App Store, Google Play, Steam and GitHub…"
          : `The console checks the stores every ${MONITOR_EVERY_MINUTES} minutes.${
              lastChecked ? ` Last check ${timeAgo(lastChecked)}.` : ""
            }`}
      </span>
      <Button variant="outline" size="sm" className="h-7" disabled={checking} onClick={onCheck}>
        <RefreshCw className={checking ? "animate-spin" : undefined} />
        {checking ? "Checking…" : "Check now"}
      </Button>
    </div>
  );
}

const SEVERITY_STYLE: Record<Severity, { border: string; icon: React.ReactNode }> = {
  error: {
    border: "border-l-destructive",
    icon: <AlertCircle className="h-5 w-5 text-destructive shrink-0" />,
  },
  warning: {
    border: "border-l-warning",
    icon: <AlertTriangle className="h-5 w-5 text-warning shrink-0" />,
  },
  info: {
    border: "border-l-border",
    icon: <Info className="h-5 w-5 text-muted-foreground shrink-0" />,
  },
};

function AttentionCard({
  item,
  icon,
  releasing,
  onRelease,
}: {
  item: AttentionItem;
  icon: string | null | undefined;
  releasing: boolean;
  onRelease: (a: { appId: string; versionId: string }) => void;
}) {
  const style = SEVERITY_STYLE[item.severity];
  return (
    <Card className={`border-l-4 ${style.border}`}>
      <CardContent className="p-4 flex gap-3">
        {icon ? <GameIcon src={icon} /> : style.icon}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium leading-snug">{item.title}</div>
          <p className="text-sm text-muted-foreground break-words">{item.detail}</p>
          {item.failedRun && (
            <div className="pt-2">
              <RunFailure {...item.failedRun} />
            </div>
          )}
          {item.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {item.actions.map((a, i) => (
                <ActionButton
                  key={a.label}
                  action={a}
                  // The failure's own Copy button is the main action when there is one.
                  primary={i === 0 && !item.failedRun}
                  releasing={releasing}
                  onRelease={onRelease}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ActionButton({
  action,
  primary,
  releasing,
  onRelease,
}: {
  action: HomeAction;
  primary: boolean;
  releasing: boolean;
  onRelease: (a: { appId: string; versionId: string }) => void;
}) {
  const variant = primary ? "default" : "outline";
  if (action.kind === "release") {
    return (
      <Button
        size="sm"
        variant={variant}
        disabled={releasing}
        onClick={() => onRelease({ appId: action.appId, versionId: action.versionId })}
      >
        {releasing ? <Loader2 className="animate-spin" /> : <Rocket />}
        {action.label}
      </Button>
    );
  }
  if (action.kind === "external") {
    return (
      <Button asChild size="sm" variant={variant}>
        <a href={action.href} target="_blank" rel="noreferrer">
          {action.label} <ExternalLink />
        </a>
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant={variant}>
      {/* The routes are data from the server, so their types can't be checked here. */}
      <Link to={action.to as any} params={action.params as any} search={action.search as any}>
        {action.label}
      </Link>
    </Button>
  );
}

function whenLabel(daysLeft: number) {
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  return `in ${daysLeft} days`;
}

function UpcomingRow({ item }: { item: UpcomingItem }) {
  const soon = item.daysLeft <= 7;
  return (
    <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
      <div className="sm:w-36 shrink-0 flex sm:flex-col gap-2 sm:gap-0.5 items-baseline">
        <span className={`text-sm font-medium ${soon ? "text-warning" : ""}`}>
          {whenLabel(item.daysLeft)}
        </span>
        <span className="text-xs text-muted-foreground">{formatDay(item.date)}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium leading-snug">{item.title}</div>
        <p className="text-sm text-muted-foreground">{item.detail}</p>
        {item.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {item.actions.map((a, i) => (
              <ActionButton
                key={a.label}
                action={a}
                primary={i === 0}
                releasing={false}
                onRelease={() => {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AppleMembershipRow() {
  return (
    <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
      <div className="sm:w-36 shrink-0">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="font-medium leading-snug">When does the Apple Developer Program renew?</div>
        <p className="text-sm text-muted-foreground">
          Apple doesn't tell the console, and if the membership lapses every game leaves the App
          Store. Add it as a yearly expense (99 € a year, starting the day it was last paid) and
          Home reminds you a month before.
        </p>
        <div className="pt-1">
          <Button asChild size="sm" variant="outline">
            <Link to="/expenses">Add it in Expenses</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function GlanceCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground label-mono">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}

function GameIcon({ src }: { src: string | null | undefined }) {
  return (
    <div className="h-9 w-9 rounded-md border border-border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

function GameRow({ game, icon }: { game: GameStatus; icon: string | null | undefined }) {
  const store = game.appStore;
  const storeTone = !store
    ? null
    : REJECTED_STATES.includes(store.state)
      ? "destructive"
      : IN_REVIEW_STATES.includes(store.state) || store.state === "PENDING_DEVELOPER_RELEASE"
        ? "warning"
        : "muted";
  const deploy = game.deploy;
  const deployLabel = !deploy
    ? null
    : deploy.status !== "completed"
      ? "deploying"
      : deploy.conclusion === "success"
        ? `deployed ${timeAgo(deploy.created)}`
        : deploy.conclusion === "cancelled"
          ? "last deploy cancelled"
          : "last deploy failed";
  const crashes = game.android ? game.android.crashes + game.android.anrs : null;
  return (
    <Link
      to="/apps/$id"
      params={{ id: game.id }}
      className="p-3 sm:px-4 flex items-center gap-3 hover:bg-accent/40 transition-colors"
    >
      <GameIcon src={icon} />
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{game.name}</div>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {store && (
            <Chip tone={storeTone!}>
              App Store {store.version} · {appStoreStateLabel(store.state)}
            </Chip>
          )}
          {deployLabel && (
            <Chip
              tone={
                deploy!.status === "completed" && deploy!.conclusion !== "success"
                  ? deploy!.conclusion === "cancelled"
                    ? "muted"
                    : "destructive"
                  : "muted"
              }
            >
              {deployLabel}
            </Chip>
          )}
          {crashes != null && (
            <Chip tone={crashes > 0 ? "warning" : "muted"}>
              Android:{" "}
              {crashes === 0 ? "no crashes" : `${crashes} crash${crashes === 1 ? "" : "es"}`} this
              week
            </Chip>
          )}
          {game.reviewsThisWeek > 0 && (
            <Chip tone="muted">
              {game.reviewsThisWeek} new review{game.reviewsThisWeek === 1 ? "" : "s"}
            </Chip>
          )}
        </div>
      </div>
    </Link>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "destructive" | "warning" | "muted";
  children: React.ReactNode;
}) {
  const cls = {
    destructive: "border-destructive/40 text-destructive",
    warning: "border-warning/40 text-warning",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <Badge variant="outline" className={`font-normal ${cls}`}>
      {children}
    </Badge>
  );
}

function timeAgo(iso: string) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `on ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
