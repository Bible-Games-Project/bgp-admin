import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CURRENCIES,
  type Expense,
  type ExpenseCurrency,
  type ExpenseFrequency,
  formatDay,
  isRecurring,
} from "@/lib/expenses";
import { saveExpense } from "@/lib/expenses.functions";

type FormValues = {
  name: string;
  amount: string;
  currency: ExpenseCurrency;
  frequency: ExpenseFrequency;
  starts_on: string;
  cancelled: boolean;
  ends_on: string;
  /** "" for the whole project. */
  app_id: string;
  notes: string;
};

// Fill the form with the usual price; it can still be changed before saving.
const COMMON: {
  label: string;
  values: Pick<FormValues, "name" | "amount" | "currency" | "frequency">;
}[] = [
  {
    label: "Apple Developer Program",
    values: { name: "Apple Developer Program", amount: "99", currency: "EUR", frequency: "yearly" },
  },
  {
    label: "Google Play account",
    values: {
      name: "Google Play developer account",
      amount: "25",
      currency: "USD",
      frequency: "once",
    },
  },
  {
    label: "Steam Direct fee",
    values: { name: "Steam Direct fee", amount: "100", currency: "USD", frequency: "once" },
  },
  {
    label: "Claude",
    values: { name: "Claude", amount: "20", currency: "USD", frequency: "monthly" },
  },
];

type SaveInput = {
  id: string | null;
  priceFrom: string | null;
  expense: Omit<Expense, "id">;
};

const FREQUENCIES: { value: ExpenseFrequency; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "monthly", label: "Every month" },
  { value: "yearly", label: "Every year" },
];

const WHOLE_PROJECT = "whole-project";

function initialValues(expense: Expense | null, today: string, cancel: boolean): FormValues {
  if (!expense) {
    return {
      name: "",
      amount: "",
      currency: "EUR",
      frequency: "monthly",
      starts_on: today,
      cancelled: false,
      ends_on: today,
      app_id: "",
      notes: "",
    };
  }
  return {
    name: expense.name,
    amount: String(expense.amount),
    currency: expense.currency,
    frequency: expense.frequency,
    starts_on: expense.starts_on,
    cancelled: cancel || !!expense.ends_on,
    ends_on: expense.ends_on ?? today,
    app_id: expense.app_id ?? "",
    notes: expense.notes ?? "",
  };
}

/** "4,99" works as well as "4.99". NaN when it isn't a number. */
function parseAmount(raw: string) {
  const text = raw.trim().replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  cancel = false,
  apps,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null to add a new one. */
  expense: Expense | null;
  /** Opens a running subscription already marked cancelled as of today. */
  cancel?: boolean;
  apps: { id: string; name: string }[];
  today: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Keyed so reopening starts from the expense's saved values. */}
        {open && (
          <ExpenseForm
            key={expense?.id ?? "new"}
            expense={expense}
            cancel={cancel}
            apps={apps}
            today={today}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({
  expense,
  cancel,
  apps,
  today,
  onDone,
}: {
  expense: Expense | null;
  cancel: boolean;
  apps: { id: string; name: string }[];
  today: string;
  onDone: () => void;
}) {
  const [v, setV] = useState<FormValues>(() => initialValues(expense, today, cancel));
  const [priceMode, setPriceMode] = useState<"from" | "always">("from");
  const [priceFrom, setPriceFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<FormValues>) => {
    setV((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const qc = useQueryClient();
  const saveFn = useServerFn(saveExpense);
  const saveM = useMutation({
    mutationFn: (input: SaveInput) => saveFn({ data: input }),
    onSuccess: (result) => {
      toast.success(
        result.split
          ? `${v.name.trim()}: new price saved from ${formatDay(priceFrom)}`
          : expense
            ? `${v.name.trim()} saved`
            : `${v.name.trim()} added`,
      );
      qc.invalidateQueries({ queryKey: ["expenses"] });
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });

  const recurring = isRecurring(v);
  const amount = parseAmount(v.amount);
  // A recurring expense already paid at least once whose price or billing changed:
  // ask whether the change is new, or a correction of what was typed.
  const priceChanged =
    !!expense &&
    isRecurring(expense) &&
    recurring &&
    expense.starts_on < today &&
    (amount !== expense.amount ||
      v.currency !== expense.currency ||
      v.frequency !== expense.frequency);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) return setError("Give the expense a name.");
    if (!(amount > 0)) return setError("Enter the amount paid, e.g. 99 or 4.99.");
    if (!v.starts_on)
      return setError(
        recurring ? "Enter the first payment's date." : "Enter the date it was paid.",
      );
    if (recurring && v.cancelled) {
      if (!v.ends_on) return setError("Enter the date it was cancelled.");
      if (v.ends_on < v.starts_on)
        return setError("It can't be cancelled before its first payment.");
    }
    const splitFrom = priceChanged && priceMode === "from" ? priceFrom : null;
    if (priceChanged && priceMode === "from") {
      if (!splitFrom) return setError("Enter the date the new price starts.");
      if (splitFrom <= expense!.starts_on) {
        return setError(
          `The new price has to start after the first payment (${formatDay(expense!.starts_on)}). If it was always this price, pick "It was always this price".`,
        );
      }
      if (recurring && v.cancelled && v.ends_on < splitFrom) {
        return setError("The new price can't start after the expense was cancelled.");
      }
    }
    saveM.mutate({
      id: expense?.id ?? null,
      priceFrom: splitFrom,
      expense: {
        name: v.name.trim(),
        amount,
        currency: v.currency,
        frequency: v.frequency,
        starts_on: v.starts_on,
        ends_on: recurring && v.cancelled ? v.ends_on : null,
        app_id: v.app_id || null,
        notes: v.notes.trim() || null,
      },
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{expense ? `Edit ${expense.name}` : "Add expense"}</DialogTitle>
        <DialogDescription>
          Something the project pays for: a developer account, a subscription, a tool, a one-off
          purchase.
        </DialogDescription>
      </DialogHeader>

      {!expense && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Common ones</Label>
          <div className="flex flex-wrap gap-2">
            {COMMON.map((c) => (
              <Button
                key={c.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set(c.values)}
              >
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="expense-name">Name</Label>
        <Input
          id="expense-name"
          value={v.name}
          maxLength={100}
          placeholder="e.g. Apple Developer Program"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="expense-amount">Amount</Label>
        <div className="flex gap-2">
          <Input
            id="expense-amount"
            inputMode="decimal"
            value={v.amount}
            placeholder="99.00"
            onChange={(e) => set({ amount: e.target.value })}
            className="flex-1"
          />
          <Select value={v.currency} onValueChange={(c) => set({ currency: c as ExpenseCurrency })}>
            <SelectTrigger className="w-[110px]" aria-label="Currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "EUR" ? "€ EUR" : "$ USD"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[11px] text-muted-foreground">
          What is actually charged each time, taxes included. Dollars are converted to euros at each
          payment's exchange rate.
        </p>
      </div>

      <div className="space-y-2">
        <Label>How often</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          value={v.frequency}
          onValueChange={(f) => f && set({ frequency: f as ExpenseFrequency })}
          className="justify-start flex-wrap"
        >
          {FREQUENCIES.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value}>
              {f.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {priceChanged && (
        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
          <Label>When did the price change?</Label>
          <RadioGroup value={priceMode} onValueChange={(m) => setPriceMode(m as "from" | "always")}>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="from" id="price-from" className="mt-0.5" />
              <div className="space-y-2 flex-1">
                <Label htmlFor="price-from" className="font-normal">
                  From this date on. Earlier payments keep the old price.
                </Label>
                {priceMode === "from" && (
                  <Input
                    type="date"
                    value={priceFrom}
                    onChange={(e) => {
                      setPriceFrom(e.target.value);
                      setError(null);
                    }}
                    className="w-[180px]"
                    aria-label="New price from"
                  />
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="always" id="price-always" className="mt-0.5" />
              <Label htmlFor="price-always" className="font-normal">
                It was always this price. I'm fixing a typo.
              </Label>
            </div>
          </RadioGroup>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="expense-start">{recurring ? "First payment" : "Paid on"}</Label>
        <Input
          id="expense-start"
          type="date"
          value={v.starts_on}
          onChange={(e) => set({ starts_on: e.target.value })}
          className="w-[180px]"
        />
        {recurring && (
          <p className="text-[11px] text-muted-foreground">
            The next ones fall on the same day every {v.frequency === "monthly" ? "month" : "year"}.
            If you don't know the exact day, any day of that month works.
          </p>
        )}
      </div>

      {recurring && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Switch
              id="expense-cancelled"
              checked={v.cancelled}
              onCheckedChange={(cancelled) => set({ cancelled })}
            />
            <Label htmlFor="expense-cancelled" className="font-normal">
              Cancelled: no longer paying for it
            </Label>
          </div>
          {v.cancelled && (
            <div className="space-y-2 pl-11">
              <Input
                type="date"
                value={v.ends_on}
                onChange={(e) => set({ ends_on: e.target.value })}
                className="w-[180px]"
                aria-label="Cancelled on"
              />
              <p className="text-[11px] text-muted-foreground">
                Payments after this date don't count.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label>Game</Label>
        <Select
          value={v.app_id || WHOLE_PROJECT}
          onValueChange={(id) => set({ app_id: id === WHOLE_PROJECT ? "" : id })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={WHOLE_PROJECT}>Whole project</SelectItem>
            {apps.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Pick a game only when that game alone needs it, like its Steam Direct fee. Revenue then
          counts it when you look at that game.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="expense-notes">Notes (optional)</Label>
        <Textarea
          id="expense-notes"
          value={v.notes}
          maxLength={1000}
          rows={2}
          placeholder="e.g. paid with Joan's card"
          onChange={(e) => set({ notes: e.target.value })}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saveM.isPending} className="gap-2">
          {saveM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {expense ? "Save" : "Add expense"}
        </Button>
      </DialogFooter>
    </form>
  );
}
