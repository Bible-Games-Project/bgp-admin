-- Downloads for the Downloads page, filled by the hourly income job
-- (src/lib/income-sync.server.ts) next to income_reports:
-- - App Store: the first-time downloads in the same sales reports the income comes
--   from, keyed like them ("month:2026-08", "year:2025", "day:2026-09-14").
-- - Google Play: each game's monthly install statistics, "installs:<package>:2026-08",
--   read again whenever Google rewrites the file (version holds its generation).
CREATE TABLE public.download_reports (
  source text NOT NULL CHECK (source IN ('app_store', 'google_play')),
  report text NOT NULL,
  -- The month ("2026-08") or year ("2025") the rows count towards.
  period text NOT NULL CHECK (period ~ '^\d{4}(-\d{2})?$'),
  version text,
  -- DownloadRow objects (src/lib/downloads.ts).
  rows jsonb NOT NULL DEFAULT '[]',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, report)
);

GRANT SELECT ON public.download_reports TO authenticated;
GRANT ALL ON public.download_reports TO service_role;

ALTER TABLE public.download_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view download reports"
  ON public.download_reports FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- A free demo points at the full game it leads to, so the Downloads page can say how many
-- demo players bought the full game.
ALTER TABLE public.apps
  ADD COLUMN full_game_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  ADD CONSTRAINT apps_full_game_not_itself CHECK (full_game_id IS DISTINCT FROM id);
