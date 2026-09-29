import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AlertTriangle, CalendarDays, Euro, Loader2, ShoppingBag, TrendingUp } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
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
import { listApps } from "@/lib/apps.functions";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";
import {
  type IncomeRow,
  type IncomeSource,
  type Preset,
  KIND_LABELS,
  SOURCE_LABELS,
  addMonths,
  byApp,
  byProduct,
  chartBuckets,
  monthKey,
  selectRows,
  totals,
} from "@/lib/income";
import {
  getAppStoreIncome,
  getAppStoreMonthByDay,
  getGooglePlayIncome,
} from "@/lib/income.functions";
import { appStoreIds } from "@/lib/app-kind";

const searchSchema = z.object({
  preset: z.enum(["month", "12m", "year", "all"]).catch("12m"),
  app: z.string().nullable().catch(null),
  store: z.enum(["app_store", "google_play"]).nullable().catch(null),
});

export const Route = createFileRoute("/_authenticated/revenue")({
  validateSearch: (s) => searchSchema.parse(s),
  component: RevenuePage,
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

// The stores' reports change once a day at most.
const STALE_MS = 30 * 60 * 1000;

const fmtEUR = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(n);

const monthLabel = (month: string, withYear = true) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: withYear ? "short" : "long",
    year: withYear ? "2-digit" : undefined,
    timeZone: "UTC",
  });

const ESTIMATE_HINT =
  "Estimated: Google Play closes a month around the 5th of the next one. Until then this is worked out from its sales.";

function Amount({ value, estimated }: { value: number; estimated?: boolean }) {
  return (
    <span title={estimated ? ESTIMATE_HINT : undefined}>
      {estimated && "≈ "}
      {fmtEUR(value)}
    </span>
  );
}

function RevenuePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const now = useMemo(() => new Date(), []);
  const currentMonth = monthKey(now);
  const lastMonth = addMonths(currentMonth, -1);

  const adminFn = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const enabled = !!adminQ.data?.isAdmin;

  const listAppsFn = useServerFn(listApps);
  const appsQ = useQuery({ queryKey: ["apps"], queryFn: () => listAppsFn(), enabled });

  const appStoreFn = useServerFn(getAppStoreIncome);
  const appStoreDaysFn = useServerFn(getAppStoreMonthByDay);
  const playFn = useServerFn(getGooglePlayIncome);

  const appStoreQ = useQuery({
    queryKey: ["income", "app_store"],
    queryFn: () => appStoreFn(),
    enabled,
    staleTime: STALE_MS,
  });
  // The current month, and a last month Apple has not published yet, come day by day.
  const dayMonths = [currentMonth, ...(appStoreQ.data?.pendingMonths ?? [])];
  const appStoreDaysQs = useQueries({
    queries: dayMonths.map((month) => ({
      queryKey: ["income", "app_store_days", month],
      queryFn: () => appStoreDaysFn({ data: { month } }),
      enabled,
      staleTime: STALE_MS,
    })),
  });
  const playQ = useQuery({
    queryKey: ["income", "google_play"],
    queryFn: () => playFn(),
    enabled,
    staleTime: STALE_MS,
  });

  const results = [appStoreQ, ...appStoreDaysQs, playQ];
  const loading = results.some((q) => q.isLoading);

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
          Your account is not authorized to view revenue.
        </p>
      </div>
    );
  }

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    (navigate as any)({ search: (prev: any) => ({ ...prev, ...patch }) });

  // Console names win over store names, so an app reads the same here as everywhere else.
  // Each store reports a game under its own ID for that store; mapping them all to one
  // key adds a game up as one app even when its App Store and Google Play IDs differ.
  const consoleApps = new Map<string, { key: string; name: string }>();
  for (const a of appsQ.data?.apps ?? []) {
    const ids = appStoreIds(a);
    const key = ids.ios ?? ids.android;
    if (!key) continue;
    for (const id of [ids.ios, ids.android]) if (id) consoleApps.set(id, { key, name: a.name });
  }
  const rows: IncomeRow[] = results
    .flatMap((q) => q.data?.rows ?? [])
    .map((r) => {
      const app = consoleApps.get(r.appKey);
      return app ? { ...r, appKey: app.key, appName: app.name } : r;
    });

  const problems = [
    ...[appStoreQ, ...appStoreDaysQs].map((q) => ({
      source: "app_store" as IncomeSource,
      message: q.data?.problem ?? q.error?.message,
    })),
    { source: "google_play" as IncomeSource, message: playQ.data?.problem ?? playQ.error?.message },
  ].filter(
    (p, i, all): p is { source: IncomeSource; message: string } =>
      !!p.message && all.findIndex((o) => o.message === p.message) === i,
  );

  const appOptions = [
    ...new Map(rows.filter((r) => r.appKey).map((r) => [r.appKey, r.appName])),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = rows.filter(
    (r) => (!search.store || r.source === search.store) && (!search.app || r.appKey === search.app),
  );
  const selected = selectRows(filtered, search.preset, now);

  const period = totals(selected);
  const thisMonth = totals(filtered.filter((r) => r.period === currentMonth));
  const previousMonth = totals(filtered.filter((r) => r.period === lastMonth));
  const chart = chartBuckets(selected, search.preset, now);
  const apps = byApp(selected);
  const products = byProduct(selected);
  const sources: IncomeSource[] = search.store ? [search.store] : ["app_store", "google_play"];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="label-mono">analytics</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Revenue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything the App Store and Google Play pay for every game, after their fees, in euros.
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
            value={search.app ?? "all"}
            onValueChange={(v) => setSearch({ app: v === "all" ? null : v })}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All apps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All apps</SelectItem>
              {appOptions.map(([key, name]) => (
                <SelectItem key={key} value={key}>
                  {name}
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

      {problems.map((p) => (
        <Alert key={p.message}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{SOURCE_LABELS[p.source]} income is missing</AlertTitle>
          <AlertDescription className="text-muted-foreground">{p.message}</AlertDescription>
        </Alert>
      ))}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Net income"
          value={<Amount value={period.netEur} estimated={period.estimated} />}
          hint={PRESET_LABELS[search.preset]}
          icon={<Euro className="h-4 w-4" />}
          loading={loading}
        />
        <StatCard
          label="This month"
          value={<Amount value={thisMonth.netEur} estimated={thisMonth.estimated} />}
          hint={`So far in ${monthLabel(currentMonth, false)}`}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={loading}
        />
        <StatCard
          label="Last month"
          value={<Amount value={previousMonth.netEur} estimated={previousMonth.estimated} />}
          hint={monthLabel(lastMonth, false)}
          icon={<CalendarDays className="h-4 w-4" />}
          loading={loading}
        />
        <StatCard
          label="Sales"
          value={period.units.toLocaleString("en-US")}
          hint={`${period.refunds} refunded · ${PRESET_LABELS[search.preset].toLowerCase()}`}
          icon={<ShoppingBag className="h-4 w-4" />}
          loading={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Income per {search.preset === "all" ? "year" : "month"}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          {loading ? (
            <CenteredNote>
              <Loader2 className="h-4 w-4 animate-spin" />
            </CenteredNote>
          ) : selected.length === 0 ? (
            <CenteredNote>No sales in this period.</CenteredNote>
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
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke="var(--border)"
                  tickFormatter={(v) => `€${v}`}
                />
                <RTooltip
                  formatter={(v: number, name: string) => [fmtEUR(v), name]}
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
                    stackId="income"
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
          <CardTitle className="text-sm font-medium">By app</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead className="text-right">App Store</TableHead>
                <TableHead className="text-right">Google Play</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.length === 0 ? (
                <EmptyRow cols={5} loading={loading} />
              ) : (
                apps.map((a) => (
                  <TableRow key={a.appKey || "account"}>
                    <TableCell>
                      <div className="text-sm font-medium">{a.appName}</div>
                      {a.appKey && (
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {a.appKey}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {a.app_store ? fmtEUR(a.app_store) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {a.google_play ? (
                        <Amount value={a.google_play} estimated={a.estimated} />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      <Amount value={a.netEur} estimated={a.estimated} />
                    </TableCell>
                    <TableCell className="text-right text-sm">{a.units || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">By product</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 ? (
                <EmptyRow cols={6} loading={loading} />
              ) : (
                products.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell>
                      <div className="text-sm">{p.productName}</div>
                      <div className="text-[11px] text-muted-foreground">{KIND_LABELS[p.kind]}</div>
                    </TableCell>
                    <TableCell className="text-sm">{p.appName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs whitespace-nowrap">
                        {SOURCE_LABELS[p.source]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{p.units || "—"}</TableCell>
                    <TableCell className="text-right text-sm">{p.refunds || "—"}</TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      <Amount value={p.netEur} estimated={p.estimated} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground max-w-3xl">
        Amounts are what the stores pay: the price minus their fee and the taxes they collect. App
        Store sales are converted to euros at the European Central Bank's rate for each month. ≈
        marks Google Play months not closed yet (Google closes a month around the 5th of the next
        one); until then they're worked out from its sales minus its 15% fee. Today's sales show up
        tomorrow.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground label-mono">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="text-2xl font-semibold tracking-tight">
          {loading ? <span className="text-muted-foreground">…</span> : value}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function EmptyRow({ cols, loading }: { cols: number; loading: boolean }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center text-xs text-muted-foreground py-6">
        {loading ? "Loading…" : "No sales in this period."}
      </TableCell>
    </TableRow>
  );
}
