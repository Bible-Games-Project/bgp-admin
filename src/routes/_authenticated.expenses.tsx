import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Sigma,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ExpenseDialog } from "@/components/ExpenseDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listApps } from "@/lib/apps.functions";
import { isCurrentUserAdmin } from "@/lib/deploy.functions";
import {
  type Expense,
  type ExpensePayment,
  formatDay,
  formatMoney,
  isRecurring,
  isRunning,
  monthlyShare,
  nextPaymentDate,
  priceLabel,
  totalEur,
} from "@/lib/expenses";
import { deleteExpense, listExpenses } from "@/lib/expenses.functions";

export const Route = createFileRoute("/_authenticated/expenses")({
  component: ExpensesPage,
});

const fmtEUR = (n: number) => formatMoney(n, "EUR");

function ExpensesPage() {
  const adminFn = useServerFn(isCurrentUserAdmin);
  const adminQ = useQuery({ queryKey: ["isAdmin"], queryFn: () => adminFn() });
  const enabled = !!adminQ.data?.isAdmin;

  const listAppsFn = useServerFn(listApps);
  const appsQ = useQuery({ queryKey: ["apps"], queryFn: () => listAppsFn(), enabled });
  const listFn = useServerFn(listExpenses);
  const q = useQuery({ queryKey: ["expenses"], queryFn: () => listFn(), enabled });

  const [dialog, setDialog] = useState<{ expense: Expense | null; cancel?: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteExpense);
  const deleteM = useMutation({
    mutationFn: (e: Expense) => deleteFn({ data: { id: e.id } }),
    onSuccess: (_, e) => {
      toast.success(`${e.name} deleted`);
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const localToday = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const today = q.data?.today ?? localToday;

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
          Your account is not authorized to view expenses.
        </p>
      </div>
    );
  }

  const apps = [...(appsQ.data?.apps ?? [])]
    .map((a) => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const appName = new Map(apps.map((a) => [a.id, a.name]));
  const expenses = q.data?.expenses ?? [];
  const payments = q.data?.payments ?? [];
  const paymentsOf = new Map<string, ExpensePayment[]>();
  for (const p of payments)
    paymentsOf.set(p.expenseId, [...(paymentsOf.get(p.expenseId) ?? []), p]);

  const running = expenses
    .filter((e) => isRunning(e, today))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ended = expenses
    .filter((e) => isRecurring(e) && !isRunning(e, today))
    .sort((a, b) => (b.ends_on ?? "").localeCompare(a.ends_on ?? ""));
  const oneOff = expenses
    .filter((e) => !isRecurring(e))
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on));

  // Only the ones already being paid: a subscription that starts next month isn't a cost yet.
  const monthly = running
    .filter((e) => e.starts_on <= today)
    .reduce((sum, e) => sum + monthlyShare(e.frequency, e.amountEur ?? 0), 0);
  const year = today.slice(0, 4);
  const paidThisYear = totalEur(payments.filter((p) => p.date.startsWith(year)));
  const paidTotal = totalEur(payments);
  const firstPayment = payments.map((p) => p.date).sort()[0];

  const row = (e: (typeof expenses)[number]) => (
    <ExpenseRow
      key={e.id}
      expense={e}
      amountEur={e.amountEur}
      paid={totalEur(paymentsOf.get(e.id) ?? [])}
      game={e.app_id ? appName.get(e.app_id) : undefined}
      today={today}
      onEdit={() => setDialog({ expense: e })}
      onDelete={() => setDeleting(e)}
    />
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto w-full space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="label-mono">analytics</span>
          <h1 className="text-2xl font-display font-semibold tracking-tight mt-1">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            What the project pays for: developer accounts, subscriptions, tools and one-off
            purchases. The{" "}
            <Link
              to="/revenue"
              search={{ preset: "12m", app: null, store: null }}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Revenue
            </Link>{" "}
            page takes them off the stores' income to show the profit.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setDialog({ expense: null })}>
          <Plus className="h-4 w-4" /> Add expense
        </Button>
      </div>

      {(q.data?.problem || q.error) && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {q.error ? "Expenses couldn't be loaded" : "Some amounts are missing"}
          </AlertTitle>
          <AlertDescription className="text-muted-foreground">
            {q.data?.problem ?? q.error?.message}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Monthly cost"
          value={fmtEUR(monthly)}
          hint={
            running.length
              ? `${running.length} running · yearly ones spread over 12 months`
              : "Nothing paid every month or year"
          }
          icon={<CalendarClock className="h-4 w-4" />}
          loading={q.isLoading}
        />
        <StatCard
          label="Paid this year"
          value={fmtEUR(paidThisYear)}
          hint={`Since Jan 1, ${year}`}
          icon={<CalendarDays className="h-4 w-4" />}
          loading={q.isLoading}
        />
        <StatCard
          label="Paid in total"
          value={fmtEUR(paidTotal)}
          hint={firstPayment ? `Since ${formatDay(firstPayment)}` : "Nothing paid yet"}
          icon={<Sigma className="h-4 w-4" />}
          loading={q.isLoading}
        />
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : expenses.length === 0 && !q.error ? (
        <div className="rounded-md border border-border bg-card p-8 text-center space-y-3">
          <Receipt className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            No expenses yet. Add what the project pays for, such as the Apple Developer Program, the
            Google Play developer account, Steam fees or AI tools, to see on Revenue whether the
            games pay for themselves.
          </p>
          <Button className="gap-2" onClick={() => setDialog({ expense: null })}>
            <Plus className="h-4 w-4" /> Add the first expense
          </Button>
        </div>
      ) : (
        <>
          {running.length + ended.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Subscriptions and yearly fees</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {running.map(row)}
                {ended.map(row)}
              </CardContent>
            </Card>
          )}
          {oneOff.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">One-off payments</CardTitle>
              </CardHeader>
              <CardContent className="p-0">{oneOff.map(row)}</CardContent>
            </Card>
          )}
          <p className="text-xs text-muted-foreground max-w-3xl">
            Only payments up to today count. Dollar amounts are converted to euros at the European
            Central Bank's rate for the month of each payment. When a subscription changes price,
            edit it and choose the date the new price starts: the months already paid keep the old
            one.
          </p>
        </>
      )}

      <ExpenseDialog
        open={!!dialog}
        onOpenChange={(open) => !open && setDialog(null)}
        expense={dialog?.expense ?? null}
        cancel={dialog?.cancel}
        apps={apps}
        today={today}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && isRecurring(deleting) && !deleting.ends_on
                ? "Every payment it made stops counting, past ones too. If you just stopped paying for it, edit it and mark it cancelled instead: what was already paid keeps counting."
                : "Its payments stop counting on Revenue. Delete it only if it was entered by mistake."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            {deleting && isRecurring(deleting) && !deleting.ends_on && (
              <Button
                variant="outline"
                onClick={() => {
                  setDialog({ expense: deleting, cancel: true });
                  setDeleting(null);
                }}
              >
                Mark cancelled instead
              </Button>
            )}
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteM.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteM.mutate(deleting);
              }}
            >
              {deleteM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExpenseRow({
  expense: e,
  amountEur,
  paid,
  game,
  today,
  onEdit,
  onDelete,
}: {
  expense: Expense;
  amountEur: number | null;
  paid: number;
  game?: string;
  today: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const next = nextPaymentDate(e, today);
  let when: string;
  if (!isRecurring(e))
    when = e.starts_on > today ? `due ${formatDay(e.starts_on)}` : `paid ${formatDay(e.starts_on)}`;
  else if (e.ends_on && e.ends_on < today) when = `cancelled ${formatDay(e.ends_on)}`;
  else if (next) when = `${e.starts_on > today ? "starts" : "next"} ${formatDay(next)}`;
  else when = `ends ${formatDay(e.ends_on!)}`;
  const ended = isRecurring(e) && !isRunning(e, today);

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-border first:border-t-0">
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${ended ? "text-muted-foreground" : ""}`}>
            {e.name}
          </span>
          {ended && (
            <Badge variant="outline" className="text-[10px]">
              Cancelled
            </Badge>
          )}
          {game && (
            <Badge variant="secondary" className="text-[10px]">
              {game}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {priceLabel(e)}
          {e.currency !== "EUR" && amountEur != null && ` (≈ ${fmtEUR(amountEur)})`} · {when}
        </div>
        {e.notes && <div className="text-xs text-muted-foreground mt-0.5 truncate">{e.notes}</div>}
      </button>
      <div className="text-right shrink-0">
        <div className="text-sm font-medium">{fmtEUR(paid)}</div>
        <div className="text-[11px] text-muted-foreground">paid so far</div>
      </div>
      <div className="flex shrink-0">
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${e.name}`}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Delete ${e.name}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
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
