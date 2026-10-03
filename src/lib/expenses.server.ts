// Reads the expenses and works out each payment in euros, for the Expenses and Revenue
// pages and Home, so all three count the same payments at the same exchange rates.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { type Expense, expensePayments } from "./expenses";
import { eurConverter } from "./income-reports";
import { fetchEurRates } from "./income.server";

/** Every expense, and each of its payments up to today in euros. */
export async function readExpenses(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .order("starts_on", { ascending: false });
  if (error) throw new Error(error.message);
  const expenses = (data ?? []).map(
    (row): Expense => ({
      id: row.id,
      name: row.name,
      amount: Number(row.amount),
      currency: row.currency as Expense["currency"],
      frequency: row.frequency as Expense["frequency"],
      starts_on: row.starts_on,
      ends_on: row.ends_on,
      app_id: row.app_id,
      notes: row.notes,
    }),
  );

  const until = new Date().toISOString().slice(0, 10);
  const foreign = expenses.filter((e) => e.currency !== "EUR").map((e) => e.starts_on);
  const from = foreign.reduce((min, d) => (d < min ? d : min), until);
  const toEur = eurConverter(
    foreign.length ? await fetchEurRates(from, until) : { daily: {}, latest: {} },
  );
  const payments = expensePayments(expenses, until, toEur);
  // What each costs today, for the monthly cost of the ones still running.
  const priced = expenses.map((e) => ({
    ...e,
    amountEur: toEur(e.amount, e.currency, until.slice(0, 7)),
  }));
  const unconverted =
    payments.some((p) => p.eur == null) || priced.some((e) => e.amountEur == null);
  return {
    expenses: priced,
    payments,
    today: until,
    problem: unconverted
      ? "No exchange rate from dollars to euros could be found right now, so dollar payments count as 0 €. Reload the page in a while."
      : undefined,
  };
}
