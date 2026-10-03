import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { addDays } from "./expenses";
import { readExpenses } from "./expenses.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-03-15.")
  .refine((d) => !Number.isNaN(Date.parse(d)) && d >= "2000-01-01" && d <= "2100-12-31", {
    message: "That date doesn't exist.",
  });

const expenseSchema = z
  .object({
    name: z.string().trim().min(1, "Give the expense a name.").max(100),
    amount: z
      .number()
      .positive("The amount has to be more than 0.")
      .max(10_000_000)
      .transform((n) => Math.round(n * 100) / 100),
    currency: z.enum(["EUR", "USD"]),
    frequency: z.enum(["once", "monthly", "yearly"]),
    starts_on: daySchema,
    ends_on: daySchema.nullable(),
    app_id: z.string().uuid().nullable(),
    notes: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .transform((n) => n || null),
  })
  .superRefine((e, ctx) => {
    if (e.ends_on && e.frequency === "once") {
      ctx.addIssue({ code: "custom", message: "A one-off payment can't be cancelled." });
    }
    if (e.ends_on && e.ends_on < e.starts_on) {
      ctx.addIssue({ code: "custom", message: "It can't be cancelled before its first payment." });
    }
  });

/** Every expense, and each of its payments so far in euros. */
export const listExpenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return readExpenses(context.supabase);
  });

/**
 * Adds an expense (no id) or changes one. With `priceFrom`, a recurring expense whose
 * price or billing changed keeps its old price up to the day before, and the new price
 * starts that day as a new expense, so the months already paid don't change.
 */
export const saveExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().nullable(),
        expense: expenseSchema,
        priceFrom: daySchema.nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    await assertAdmin(supabase, context.userId);
    const { id, expense, priceFrom } = data;

    if (!id) {
      const { error } = await supabase.from("expenses").insert(expense);
      if (error) throw new Error(error.message);
      return { split: false };
    }

    const { data: old, error: readError } = await supabase
      .from("expenses")
      .select("starts_on, ends_on")
      .eq("id", id)
      .single();
    if (readError) throw new Error(readError.message);

    if (!priceFrom || priceFrom <= old.starts_on) {
      const { error } = await supabase.from("expenses").update(expense).eq("id", id);
      if (error) throw new Error(error.message);
      return { split: false };
    }

    if (expense.ends_on && expense.ends_on < priceFrom) {
      throw new Error("The new price can't start after the expense was cancelled.");
    }
    const { data: created, error: insertError } = await supabase
      .from("expenses")
      .insert({ ...expense, starts_on: priceFrom })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);
    const dayBefore = addDays(priceFrom, -1);
    const { error: endError } = await supabase
      .from("expenses")
      .update({ ends_on: old.ends_on && old.ends_on < dayBefore ? old.ends_on : dayBefore })
      .eq("id", id);
    if (endError) {
      // Without this, the new price would count on top of the old one.
      await supabase.from("expenses").delete().eq("id", created.id);
      throw new Error(endError.message);
    }
    return { split: true };
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("expenses").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
