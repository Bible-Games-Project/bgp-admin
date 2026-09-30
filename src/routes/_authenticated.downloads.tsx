import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  AlertTriangle,
  Download,
  Loader2,
  Percent,
  RefreshCw,
  Smartphone,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";
import {
  type Conversion,
  type DownloadsGame,
  downloadBuckets,
  gameDownloads,
  selectDownloadRows,
} from "@/lib/downloads";
import { getDownloads, setFullGame } from "@/lib/downloads.functions";
import { type IncomeSource, type Preset, SOURCE_LABELS, selectRows } from "@/lib/income";
import { refreshIncome } from "@/lib/income.functions";

const searchSchema = z.object({
  preset: z.enum(["month", "12m", "year", "all"]).catch("12m"),
  /** A console app ID. */
  app: z.string().nullable().catch(null),
  store: z.enum(["app_store", "google_play"]).nullable().catch(null),
});

export const Route = createFileRoute("/_authenticated/downloads")({
  validateSearch: (s) => searchSchema.parse(s),
  component: DownloadsPage,
});

const PRESET_LABELS: Record<Preset, string> = {
  month: "This month",
  "12m": "Last 12 months",
  year: "This year",
  all: "All time",
};

const SOURCE_COLORS: Record<IncomeSource, string> = {
  app_store: "var(--primary)",
  google_play: "var(--success)",
};

// Each Refresh run reads a limited number of reports; a few cover an empty table.
const MAX_REFRESH_RUNS = 6;

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (rate: number | null) =>
  rate == null ? "—" : `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`;

const monthLabel = (month: string, withYear = true) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: withYear ? "short" : "long",
    year: withYear ? "2-digit" : undefined,
    timeZone: "UTC",
  });

function DownloadsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const now = useMemo(() => new Date(), []);
  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    (navigate as any)({ search: (prev: any) => ({ ...prev, ...patch }) });

  const adminFn = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const enabled = !!adminQ.data?.isAdmin;

  const getFn = useServerFn(getDownloads);
  const q = useQuery({
    queryKey: ["downloads"],
    queryFn: () => getFn(),
    enabled,
    refetchInterval: 5 * 60 * 1000,
  });

  const queryClient = useQueryClient();
  const refreshFn = useServerFn(refreshIncome);
  const refresh = useMutation({
    mutationFn: async () => {
      for (let run = 0; run < MAX_REFRESH_RUNS; run++) {
        const { remaining } = await refreshFn();
        await queryClient.invalidateQueries({ queryKey: ["downloads"] });
        if (!remaining) break;
      }
    },
    onError: (e: Error) =>
      toast.error(`Couldn't refresh the store data: ${e.message}`, { duration: 15000 }),
  });

  const setFullFn = useServerFn(setFullGame);
  const pair = useMutation({
    mutationFn: (v: { appId: string; fullGameId: string | null }) => setFullFn({ data: v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["downloads"] }),
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
          Your account is not authorized to view downloads.
        </p>
      </div>
    );
  }

  const data = q.data;
  const games = data?.games ?? [];
  const picked = games.find((g) => g.id === search.app);
  const keysOf = (g: DownloadsGame) => [g.keys.ios, g.keys.android].filter(Boolean) as string[];
  const inScope = <T extends { source: IncomeSource; appKey: string }>(rows: T[]) =>
    rows.filter(
      (r) =>
        (!search.store || r.source === search.store) &&
        (!picked || keysOf(picked).includes(r.appKey)),
    );
  const rows = selectDownloadRows(inScope(data?.rows ?? []), search.preset, now);
  // Conversion needs every game's sales (a demo's leads to its full game's), so income is
  // cut by period and store only.
  const income = selectRows(
    (data?.income ?? []).filter((r) => !search.store || r.source === search.store),
    search.preset,
    now,
  );
  const allRows = selectDownloadRows(
    (data?.rows ?? []).filter((r) => !search.store || r.source === search.store),
    search.preset,
    now,
  );
  const perGame = gameDownloads(games, allRows, income).filter(
    (g) => !picked || g.id === picked.id,
  );
  const total = rows.reduce((s, r) => s + r.downloads, 0);
  const byStore = (source: IncomeSource) =>
    rows.filter((r) => r.source === source).reduce((s, r) => s + r.downloads, 0);
  const devices = perGame.reduce((s, g) => s + (g.activeDevices ?? 0), 0);
  const hasDevices = perGame.some((g) => g.activeDevices != null);
  const chart = downloadBuckets(rows, search.preset, now);
  const sources: IncomeSource[] = search.store ? [search.store] : ["app_store", "google_play"];
  const loading = q.isLoading;
  const empty = !loading && !(data?.rows ?? []).length;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="label-mono">analytics</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Downloads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            How many people download each game on the App Store and Google Play, and how many of
            them end up paying.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={search.preset} onValueChange={(v) => setSearch({ preset: v as Preset })}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PRESET_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={picked?.id ?? "all"}
            onValueChange={(v) => setSearch({ app: v === "all" ? null : v })}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All games" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All games</SelectItem>
              {games.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={search.store ?? "all"}
            onValueChange={(v) => setSearch({ store: v === "all" ? null : (v as IncomeSource) })}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stores</SelectItem>
              <SelectItem value="app_store">App Store</SelectItem>
              <SelectItem value="google_play">Google Play</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex-1 min-w-[200px]">
          {refresh.isPending
            ? "Reading the latest reports from the App Store and Google Play…"
            : "Downloads update every hour, with the sales reports. The App Store counts first downloads (not re-downloads or updates); Google Play counts people who installed the game."}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
          {refresh.isPending ? "Refreshing…" : "Refresh now"}
        </Button>
      </div>

      {q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
      {data?.playProblem && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Google Play downloads are missing</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            Google keeps them next to its financial reports, which the console can't read yet.{" "}
            {data.playProblem}
          </AlertDescription>
        </Alert>
      )}
      {empty && (
        <Alert>
          <Download className="h-4 w-4" />
          <AlertTitle>No downloads stored yet</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            The hourly job reads them from the next run on. Press Refresh now to read them now.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Downloads"
          icon={<Download className="h-4 w-4" />}
          value={loading ? "…" : fmt(total)}
          hint={PRESET_LABELS[search.preset]}
        />
        <StatCard
          label="App Store"
          icon={<TrendingUp className="h-4 w-4" />}
          value={loading ? "…" : fmt(byStore("app_store"))}
          hint="First downloads"
        />
        <StatCard
          label="Google Play"
          icon={<TrendingUp className="h-4 w-4" />}
          value={loading ? "…" : fmt(byStore("google_play"))}
          hint="People who installed"
        />
        <StatCard
          label="Android devices"
          icon={<Smartphone className="h-4 w-4" />}
          value={loading ? "…" : hasDevices ? fmt(devices) : "—"}
          hint="With the game installed now"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Downloads per {search.preset === "all" ? "year" : "month"}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : total === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              No downloads in this period.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke="var(--border)"
                  tickFormatter={(b: string) => (b.length === 4 ? b : monthLabel(b))}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke="var(--border)"
                />
                <RTooltip
                  formatter={(v: number, name: string) => [fmt(v), name]}
                  labelFormatter={(b: string) =>
                    b.length === 4 ? b : monthLabel(b, false) + " " + b.slice(0, 4)
                  }
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    color: "var(--foreground)",
                    fontSize: 12,
                  }}
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {sources.map((s, i) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    name={SOURCE_LABELS[s]}
                    stackId="downloads"
                    fill={SOURCE_COLORS[s]}
                    radius={i === sources.length - 1 ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">By game</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Game</TableHead>
                <TableHead className="text-right">App Store</TableHead>
                <TableHead className="text-right">Google Play</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Android devices</TableHead>
                <TableHead className="text-right">Paying</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perGame.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="text-sm font-medium">{g.name}</TableCell>
                  <TableCell className="text-right text-sm">{fmt(g.app_store)}</TableCell>
                  <TableCell className="text-right text-sm">{fmt(g.google_play)}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{fmt(g.total)}</TableCell>
                  <TableCell className="text-right text-sm">
                    {g.activeDevices == null ? "—" : fmt(g.activeDevices)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <ConversionCell
                      conversion={g.conversion}
                      playMissing={!!data?.playProblem && g.google_play > 0}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Percent className="h-4 w-4 text-muted-foreground" /> Demos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A free demo leads to a paid full game. Link them and the Paying column shows how many
            full-game sales there were for every hundred demo downloads, in the stores the demo is
            on.
          </p>
          {games
            .filter((g) => g.fullGameId)
            .map((demo) => (
              <DemoRow
                key={demo.id}
                demo={demo}
                games={games}
                busy={pair.isPending}
                onChange={(fullGameId) => pair.mutate({ appId: demo.id, fullGameId })}
              />
            ))}
          <AddDemo
            games={games}
            busy={pair.isPending}
            onAdd={(appId, fullGameId) => pair.mutate({ appId, fullGameId })}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** Links one more demo to its full game. */
function AddDemo({
  games,
  busy,
  onAdd,
}: {
  games: DownloadsGame[];
  busy: boolean;
  onAdd: (appId: string, fullGameId: string) => void;
}) {
  const [demoId, setDemoId] = useState("");
  const [fullId, setFullId] = useState("");
  // A game that already is a demo, or that a demo leads to, isn't offered as a new demo.
  const candidates = games.filter(
    (g) => !g.fullGameId && !games.some((x) => x.fullGameId === g.id),
  );
  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <Select value={demoId} onValueChange={setDemoId}>
        <SelectTrigger className="w-[260px]" disabled={busy}>
          <SelectValue placeholder="Pick the demo" />
        </SelectTrigger>
        <SelectContent>
          {candidates.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">is the free demo of</span>
      <Select value={fullId} onValueChange={setFullId}>
        <SelectTrigger className="w-[260px]" disabled={busy || !demoId}>
          <SelectValue placeholder="Pick the full game" />
        </SelectTrigger>
        <SelectContent>
          {games
            .filter((g) => g.id !== demoId)
            .map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={busy || !demoId || !fullId}
        onClick={() => {
          onAdd(demoId, fullId);
          setDemoId("");
          setFullId("");
        }}
      >
        Link them
      </Button>
    </div>
  );
}

function DemoRow({
  demo,
  games,
  busy,
  onChange,
}: {
  demo: DownloadsGame;
  games: DownloadsGame[];
  busy: boolean;
  onChange: (fullGameId: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="font-medium">{demo.name}</span>
      <span className="text-muted-foreground">is the free demo of</span>
      <Select
        value={demo.fullGameId ?? ""}
        onValueChange={(v) => onChange(v === "none" ? null : v)}
      >
        <SelectTrigger className="w-[260px]" disabled={busy}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {games
            .filter((g) => g.id !== demo.id)
            .map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          <SelectItem value="none">Not a demo</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ConversionCell({
  conversion,
  playMissing,
}: {
  conversion: Conversion;
  /** Google Play's sales can't be read yet, so a Play-only rate would read 0%. */
  playMissing: boolean;
}) {
  if (playMissing && conversion.kind !== "paid" && !("rate" in conversion && conversion.rate)) {
    return <span className="text-muted-foreground text-xs">Needs Google Play's sales</span>;
  }
  switch (conversion.kind) {
    case "paid":
      return <span className="text-muted-foreground">Paid game</span>;
    case "in_app":
      return (
        <span title={`${conversion.purchases} in-app purchases per download`}>
          {pct(conversion.rate)}{" "}
          <span className="text-muted-foreground text-xs">bought in-app</span>
        </span>
      );
    case "demo":
      return (
        <span title={`${conversion.sales} sales of ${conversion.fullGame} per demo download`}>
          {pct(conversion.rate)}{" "}
          <span className="text-muted-foreground text-xs">bought the full game</span>
        </span>
      );
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

function StatCard({
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
