-- What the project pays for: developer accounts, subscriptions, tools, one-off
-- purchases. Entered by hand on the Expenses page; the Revenue page subtracts
-- them from the stores' income to show the profit.
CREATE TABLE public.expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD')),
  frequency text NOT NULL CHECK (frequency IN ('once', 'monthly', 'yearly')),
  -- The payment date of a one-off expense, or the first payment of a recurring
  -- one. Later payments fall on the same day of the month.
  starts_on date NOT NULL,
  -- A recurring expense that was cancelled: payments after this day don't count.
  ends_on date,
  -- Set when only this game needs it (its Steam Direct fee, say); null when the
  -- whole project shares it.
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  notes text CHECK (length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expenses_ends_after_start CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT expenses_only_recurring_ends CHECK (ends_on IS NULL OR frequency <> 'once')
);

CREATE INDEX expenses_app_id_idx ON public.expenses (app_id) WHERE app_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view expenses"
  ON public.expenses FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert expenses"
  ON public.expenses FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update expenses"
  ON public.expenses FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete expenses"
  ON public.expenses FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
