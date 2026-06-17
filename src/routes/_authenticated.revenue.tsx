import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  Repeat,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listApps } from "@/lib/apps.functions";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";
import {
  getRecentPurchases,
  getRevenueByApp,
  getRevenueByPlatform,
  getRevenueStats,
  getRevenueTimeseries,
  getTopProducts,
} from "@/lib/revenue.functions";

const searchSchema = z.object({
  preset: z.enum(["7d", "30d", "90d", "all"]).catch("30d"),
  appId: z.string().uuid().nullable().catch(null),
  platform: z.enum(["ios", "android"]).nullable().catch(null),
  page: z.number().int().min(1).catch(1),
});

export const Route = createFileRoute("/_authenticated/revenue")({
  validateSearch: (s) => searchSchema.parse(s),
  component: RevenuePage,
});

const PAGE_SIZE = 10;

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30",
    refunded: "bg-destructive/15 text-destructive border-destructive/30",
    cancelled: "bg-muted text-muted-foreground border-border",
    expired: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={map[status] ?? ""}>
      {status}
    </Badge>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {platform === "ios" ? "iOS" : "Android"}
    </Badge>
  );
}

function RevenuePage() {
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

  const filters = useMemo(
    () => ({
      preset: search.preset,
      appId: search.appId,
      platform: search.platform,
    }),
    [search.preset, search.appId, search.platform],
  );

  const statsFn = useServerFn(getRevenueStats);
  const tsFn = useServerFn(getRevenueTimeseries);
  const platFn = useServerFn(getRevenueByPlatform);
  const appFn = useServerFn(getRevenueByApp);
  const topFn = useServerFn(getTopProducts);
  const recentFn = useServerFn(getRecentPurchases);

  const enabled = !!adminQ.data?.isAdmin;
  const statsQ = useQuery({
    queryKey: ["rev", "stats", filters],
    queryFn: () => statsFn({ data: filters }),
    enabled,
  });
  const tsQ = useQuery({
    queryKey: ["rev", "ts", filters],
    queryFn: () => tsFn({ data: filters }),
    enabled,
  });
  const platQ = useQuery({
    queryKey: ["rev", "plat", filters],
    queryFn: () => platFn({ data: filters }),
    enabled,
  });
  const appQ = useQuery({
    queryKey: ["rev", "app", filters],
    queryFn: () => appFn({ data: filters }),
    enabled,
  });
  const topQ = useQuery({
    queryKey: ["rev", "top", filters],
    queryFn: () => topFn({ data: { ...filters, limit: 10 } }),
    enabled,
  });
  const recentQ = useQuery({
    queryKey: ["rev", "recent", filters, search.page],
    queryFn: () =>
      recentFn({
        data: {
          ...filters,
          limit: PAGE_SIZE,
          offset: (search.page - 1) * PAGE_SIZE,
        },
      }),
    enabled,
  });

  const [openRow, setOpenRow] = useState<any | null>(null);

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

  const apps = appsQ.data?.apps ?? [];
  const stats = statsQ.data;
  const totalPages = Math.max(1, Math.ceil((recentQ.data?.total ?? 0) / PAGE_SIZE));

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    (navigate as any)({ search: (prev: any) => ({ ...prev, ...patch, page: 1 }) });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="label-mono">analytics</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">
            Revenue
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={search.preset}
            onValueChange={(v) => setSearch({ preset: v as any })}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={search.appId ?? "all"}
            onValueChange={(v) => setSearch({ appId: v === "all" ? null : v })}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All apps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All apps</SelectItem>
              {apps.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={search.platform ?? "all"}
            onValueChange={(v) =>
              setSearch({ platform: v === "all" ? null : (v as any) })
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              <SelectItem value="ios">iOS</SelectItem>
              <SelectItem value="android">Android</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total revenue"
          value={fmtUSD(stats?.totalUsd ?? 0)}
          icon={<DollarSign className="h-4 w-4" />}
          loading={statsQ.isLoading}
        />
        <StatCard
          label="This month"
          value={fmtUSD(stats?.monthUsd ?? 0)}
          icon={<DollarSign className="h-4 w-4" />}
          trend={stats?.monthChangePct ?? null}
          loading={statsQ.isLoading}
        />
        <StatCard
          label="Active subscriptions"
          value={(stats?.activeSubs ?? 0).toLocaleString()}
          icon={<Users className="h-4 w-4" />}
          loading={statsQ.isLoading}
        />
        <StatCard
          label="MRR"
          value={fmtUSD(stats?.mrrUsd ?? 0)}
          icon={<Repeat className="h-4 w-4" />}
          loading={statsQ.isLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Revenue over time</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {tsQ.isLoading ? (
              <SkeletonChart />
            ) : (tsQ.data?.points ?? []).length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={tsQ.data!.points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d) =>
                      new Date(d).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <RTooltip
                    formatter={(v: number) => fmtUSD(v)}
                    labelFormatter={(d) => fmtDate(d as string)}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenueUsd"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">By platform</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {platQ.isLoading ? (
              <SkeletonChart />
            ) : (platQ.data?.rows ?? []).length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={platQ.data!.rows}
                    dataKey="revenueUsd"
                    nameKey="platform"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {platQ.data!.rows.map((r: any, i: number) => (
                      <Cell
                        key={r.platform}
                        fill={
                          i === 0
                            ? "hsl(var(--primary))"
                            : "oklch(0.68 0.14 145)"
                        }
                      />
                    ))}
                  </Pie>
                  <RTooltip formatter={(v: number) => fmtUSD(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">By app</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            {appQ.isLoading ? (
              <SkeletonChart />
            ) : (appQ.data?.rows ?? []).length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={appQ.data!.rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="appName" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <RTooltip formatter={(v: number) => fmtUSD(v)} />
                  <Bar dataKey="revenueUsd" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top products</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topQ.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : (topQ.data?.rows ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6">
                      No data
                    </TableCell>
                  </TableRow>
                ) : (
                  topQ.data!.rows.map((r: any) => (
                    <TableRow key={r.productId}>
                      <TableCell className="font-mono text-xs truncate max-w-[140px]">
                        {r.productId}
                      </TableCell>
                      <TableCell className="text-right text-xs">{r.count}</TableCell>
                      <TableCell className="text-right text-xs font-medium">
                        {fmtUSD(r.revenueUsd)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Recent transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Recent transactions</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Page {search.page} / {totalPages}
            </span>
            <Button
              size="icon"
              variant="outline"
              disabled={search.page <= 1}
              onClick={() =>
                (navigate as any)({ search: (p: any) => ({ ...p, page: Math.max(1, p.page - 1) }) })
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              disabled={search.page >= totalPages}
              onClick={() =>
                (navigate as any)({
                  search: (p: any) => ({ ...p, page: Math.min(totalPages, p.page + 1) }),
                })
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : (recentQ.data?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                    No transactions yet.
                  </TableCell>
                </TableRow>
              ) : (
                recentQ.data!.rows.map((r: any) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setOpenRow(r)}
                  >
                    <TableCell className="text-xs font-mono whitespace-nowrap">
                      {fmtDateTime(r.purchaseDate)}
                    </TableCell>
                    <TableCell className="text-xs">{r.appName ?? "—"}</TableCell>
                    <TableCell>
                      <PlatformBadge platform={r.platform} />
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[200px]">
                      {r.productId}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {fmtUSD(r.revenueUsd)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transaction details</DialogTitle>
          </DialogHeader>
          {openRow && (
            <div className="space-y-3 text-xs">
              <Field label="Transaction ID" value={openRow.transactionId} mono />
              <Field label="User ID" value={openRow.userId ?? "—"} mono />
              {openRow.localAmount != null && (
                <Field
                  label="Local amount"
                  value={`${openRow.localAmount} ${openRow.localCurrency ?? ""}`}
                />
              )}
              {openRow.subscriptionExpiresAt && (
                <Field
                  label="Subscription expires"
                  value={fmtDateTime(openRow.subscriptionExpiresAt)}
                />
              )}
              <Field label="Environment" value={openRow.environment} />
              <div>
                <div className="text-muted-foreground mb-1">Raw payload</div>
                <pre className="bg-muted rounded p-3 overflow-auto max-h-[300px] font-mono text-[11px]">
                  {JSON.stringify(openRow.rawPayload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  trend,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  trend?: number | null;
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
        {trend != null && (
          <div
            className={`flex items-center gap-1 text-xs mt-1 ${
              trend >= 0 ? "text-[oklch(0.55_0.16_145)]" : "text-destructive"
            }`}
          >
            {trend >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {Math.abs(trend).toFixed(1)}% vs last month
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SkeletonChart() {
  return (
    <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
      No data
    </div>
  );
}
