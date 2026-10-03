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
  ChevronRight,
  ExternalLink,
  ImageIcon,
  Info,
  Loader2,
  RefreshCw,
  Rocket,
  Scale,
  ShieldCheck,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Amount, ESTIMATE_HINT } from "@/components/Amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RunFailure } from "@/components/RunFailure";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";
import { formatDay } from "@/lib/expenses";
import {
  type AttentionItem,
  type GameEvent,
  type GameHighlight,
  type Glance,
  type HomeAction,
  type ProfitGlance,
  type Severity,
  type UpcomingItem,
} from "@/lib/home";
import { getHome, releaseAppStoreVersion, runChecks } from "@/lib/home.functions";
import { PRESET_LABELS, SOURCE_LABELS } from "@/lib/income";
import { MONITOR_EVERY_MINUTES } from "@/lib/monitor";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

// A Check now run stops at its request limit and hands over; a few runs cover every check.
const MAX_CHECK_RUNS = 5;

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
  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto w-full space-y-8">
      <div className="space-y-4">
        <div>
          <span className="label-mono">overview</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Home</h1>
          <p className="text-sm text-muted-foreground mt-1">
            What needs you now, what's coming up, and how the money and the games are doing.
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
            <SectionTitle>Profitability</SectionTitle>
            <ProfitCard profit={data.profit} />
          </section>

          <section className="space-y-3">
            <SectionTitle>Players · last 7 days</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <GlanceCard
                label="Player reviews"
                icon={<Star className="h-4 w-4" />}
                value={String(data.glance.reviews.week)}
                hint={
                  <>
                    Written in the stores
                    {data.glance.reviews.average != null &&
                      ` · ${data.glance.reviews.average.toFixed(1)}★ average`}
                    {" · "}
                    {data.glance.reviews.waiting} awaiting a reply ·{" "}
                    <Link
                      to="/reviews"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Reviews
                    </Link>
                  </>
                }
              />
              <CrashesCard android={data.glance.androidCrashes} />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <SectionTitle>Game activity</SectionTitle>
              <Link
                to="/apps"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                All {data.gameCount} games
              </Link>
            </div>
            {data.games.length ? (
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {data.games.map((g) => (
                    <GameRow key={g.id} game={g} icon={data.icons[g.id]} />
                  ))}
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">
                No release under way, and no deploys or player reviews in the last 7 days.
              </p>
            )}
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

/** Home's headline money number: Revenue's profit for the same period, and what may skew it. */
function ProfitCard({ profit: p }: { profit: ProfitGlance }) {
  const since = new Date(`${p.since}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const verdict = p.unread
    ? "The stores' sales haven't been read yet. Revenue reads them when it opens."
    : p.income === 0 && p.spent === 0
      ? "Nothing earned or spent in this period."
      : p.profit < 0
        ? "Losing money: the project spent more than the games earned."
        : "Profitable: the games earned more than the project spent.";
  const notes: React.ReactNode[] = [];
  if (!p.unread && p.incomplete.length) {
    notes.push(
      <>
        {p.incomplete.map((s) => SOURCE_LABELS[s]).join(" and ")} income may be incomplete: Revenue
        says why.
      </>,
    );
  }
  if (p.noExpenses) {
    notes.push(
      <>
        No expenses entered yet, so this is only the income.{" "}
        <Link to="/expenses" className="underline underline-offset-2 hover:text-foreground">
          Add them
        </Link>
      </>,
    );
  }
  if (p.unconvertedCosts) {
    notes.push("Some dollar costs count as 0 € until an exchange rate is found.");
  }
  if (!p.unread && p.estimated) {
    notes.push(`≈ ${ESTIMATE_HINT}`);
  }
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground label-mono">
            Profit · {PRESET_LABELS[p.preset].toLowerCase()}
          </span>
          <Scale className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div
              className={`text-3xl font-semibold tracking-tight ${
                p.unread
                  ? "text-muted-foreground"
                  : p.profit < 0
                    ? "text-destructive"
                    : "text-success"
              }`}
            >
              {p.unread ? "—" : <Amount value={p.profit} estimated={p.estimated} />}
            </div>
            <p className="text-sm">{verdict}</p>
          </div>
          {!p.unread && (
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm sm:text-right shrink-0">
              <dt className="text-muted-foreground">Earned after store fees</dt>
              <dd className="text-right font-medium">
                <Amount value={p.income} estimated={p.estimated} />
              </dd>
              <dt className="text-muted-foreground">Spent</dt>
              <dd className="text-right font-medium">
                <Amount value={p.spent} />
              </dd>
            </dl>
          )}
        </div>
        {notes.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {notes.map((note, i) => (
              <li key={i} className="flex gap-1.5">
                <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-muted-foreground">
          <span>{since} to today, all games and stores</span>
          <Link
            to="/revenue"
            search={{ preset: p.preset, app: null, store: null }}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Month by month in Revenue
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Crashes for each platform, so a quiet number never passes for all of them. Only Google
 * Play's are read: Apple reports crashes only from players who share analytics with
 * developers and only once five of them hit one, through an analytics report that an
 * Admin API key has to request, so the console doesn't count them.
 */
function CrashesCard({ android }: { android: Glance["androidCrashes"] }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground label-mono">Crashes</span>
          <Bug className="h-4 w-4 text-muted-foreground" />
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt>Android</dt>
            <dd className="text-right">
              {!android ? (
                <span className="text-muted-foreground">Not checked yet</span>
              ) : android.crashes + android.anrs === 0 ? (
                "None"
              ) : (
                <span className="font-medium">
                  {plural(android.crashes, "crash", "crashes")}, {plural(android.anrs, "freeze")}
                </span>
              )}
            </dd>
          </div>
          {android && android.games.length > 0 && (
            <p className="text-xs text-muted-foreground -mt-1">In {android.games.join(", ")}</p>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <dt>iPhone and iPad</dt>
            <dd className="text-right text-muted-foreground">Not tracked</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground mt-3">
          Apple only reports crashes from players who share analytics, once five or more of them
          crash, so the console doesn't count iOS crashes.
        </p>
      </CardContent>
    </Card>
  );
}

function GameRow({ game, icon }: { game: GameHighlight; icon: string | null | undefined }) {
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
          {game.events.map((e) => (
            <Badge
              key={e.kind}
              variant="outline"
              className="font-normal text-muted-foreground gap-1"
            >
              {EVENT_ICONS[e.kind]}
              {eventLabel(e)}
            </Badge>
          ))}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

const EVENT_ICONS: Record<GameEvent["kind"], React.ReactNode> = {
  apple_approval: <ShieldCheck className="h-3 w-3" />,
  approved: <ShieldCheck className="h-3 w-3" />,
  deploying: <Rocket className="h-3 w-3" />,
  deployed: <Rocket className="h-3 w-3" />,
  player_reviews: <Star className="h-3 w-3" />,
};

/** Apple's check of a version never says "review", so it can't be read as players' reviews. */
function eventLabel(e: GameEvent): string {
  switch (e.kind) {
    case "apple_approval":
      return e.state === "IN_REVIEW"
        ? `App Store ${e.version}: Apple is checking it`
        : `App Store ${e.version}: waiting for Apple's approval`;
    case "approved":
      return `App Store ${e.version}: approved, going live`;
    case "deploying":
      return `Deploying since ${timeAgo(e.since)}`;
    case "deployed":
      return `Deployed ${timeAgo(e.at)}`;
    case "player_reviews":
      return `${plural(e.count, "player review")}${
        e.average != null ? ` · ${e.average.toFixed(1)}★` : ""
      }`;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
