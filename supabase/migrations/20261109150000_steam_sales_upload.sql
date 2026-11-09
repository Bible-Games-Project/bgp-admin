-- Steam income on the Revenue page. Steam's Financial API answers with no data for this
-- partner, so an admin uploads the sales file Steamworks exports (Sales & Activations
-- Reports → "view as .csv"), and the console stores it next to the App Store and Google
-- Play reports (src/lib/steam-sales.ts, steam-sales.server.ts).

-- One income report per day and Steam package sold, keyed "day:2026-09-14 package:824731".
-- An upload replaces the reports its file covers, so uploading a file twice, or files
-- whose dates overlap, counts each sale once.
ALTER TABLE public.income_reports DROP CONSTRAINT income_reports_source_check;
ALTER TABLE public.income_reports
  ADD CONSTRAINT income_reports_source_check
  CHECK (source IN ('app_store', 'google_play', 'steam'));

-- The files uploaded, so the page can say which days Steam's income covers and what to
-- download next.
CREATE TABLE public.steam_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  -- The days the file covers (Pacific time, as Steam reports them).
  first_day date NOT NULL,
  last_day date NOT NULL,
  -- Days with sales in it, units sold net of returns, and what Valve pays for them.
  sales_days integer NOT NULL,
  units integer NOT NULL,
  net_eur numeric(12, 2) NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT steam_uploads_days_in_order CHECK (first_day <= last_day)
);

-- New public tables are open to anon and authenticated by default; only the server writes
-- here, with the service role, and admins read.
REVOKE ALL ON public.steam_uploads FROM anon, authenticated;
GRANT SELECT ON public.steam_uploads TO authenticated;
GRANT ALL ON public.steam_uploads TO service_role;

ALTER TABLE public.steam_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view Steam uploads"
  ON public.steam_uploads FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
