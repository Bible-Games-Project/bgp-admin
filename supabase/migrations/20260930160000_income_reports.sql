-- The stores' sales reports, already read and converted to euros, so the Revenue page
-- loads them from here instead of downloading dozens of reports from Apple and Google
-- on every visit. A job on the console's Worker (src/tasks/income-sync.ts) fetches the
-- new ones every hour; the Refresh button on the Revenue page runs the same job.
--
-- A stored report is never thrown away just because the store stops offering it: Apple
-- keeps monthly reports for only a year, and here they stay. A report only goes once a
-- better one covers the same period (see supersededReports in src/lib/income-sync.ts).
CREATE TABLE public.income_reports (
  source text NOT NULL CHECK (source IN ('app_store', 'google_play')),
  -- Which report this is. App Store: "month:2026-08", "year:2025", or "day:2026-09-14"
  -- for a month Apple has not closed yet. Google Play: "earnings:2026-08" for a closed
  -- month, "sales:2026-09" for a month still estimated from its sales.
  report text NOT NULL,
  -- The month ("2026-08") or year ("2025") the rows count towards.
  period text NOT NULL CHECK (period ~ '^\d{4}(-\d{2})?$'),
  -- Google Play only: the report files and their Cloud Storage generations, so a file
  -- that Google rewrote is read again. Null for App Store reports, which never change.
  version text,
  -- Currencies with no exchange rate to euros when the report was read. Their sales are
  -- left out of the rows, and the report is read again on the next run.
  unconverted text[] NOT NULL DEFAULT '{}',
  -- IncomeRow objects (src/lib/income.ts).
  rows jsonb NOT NULL DEFAULT '[]',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, report)
);

-- How the last run went for each store.
CREATE TABLE public.income_sync (
  source text PRIMARY KEY CHECK (source IN ('app_store', 'google_play')),
  checked_at timestamptz NOT NULL,
  -- Why the store could not be read, and what to do about it. Null when it could.
  problem text
);

-- Only the job writes, with the service role; admins read.
GRANT SELECT ON public.income_reports, public.income_sync TO authenticated;
GRANT ALL ON public.income_reports, public.income_sync TO service_role;

ALTER TABLE public.income_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view income reports"
  ON public.income_reports FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can view income sync"
  ON public.income_sync FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
