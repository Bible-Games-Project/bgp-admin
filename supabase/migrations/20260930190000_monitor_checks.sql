-- What the monitor job (src/tasks/monitor.ts) last found for each thing it watches:
-- App Store review states, new reviews, deploy results, Android crashes, certificates
-- and other expiry dates. The Home page reads this table instead of asking the stores
-- on every visit, and the job compares each new result with the stored one to know
-- what to announce on Telegram.
CREATE TABLE public.monitor_checks (
  -- Which check, e.g. "app_store", "reviews_google_play", "signing".
  key text PRIMARY KEY,
  ran_at timestamptz NOT NULL,
  -- The check's result, in the shape src/lib/monitor.ts gives it.
  state jsonb NOT NULL DEFAULT '{}',
  -- Why it could not look, and what to do about it. Null when it could.
  problem text
);

-- Only the job writes, with the service role; admins read.
GRANT SELECT ON public.monitor_checks TO authenticated;
GRANT ALL ON public.monitor_checks TO service_role;

ALTER TABLE public.monitor_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view monitor checks"
  ON public.monitor_checks FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Console-wide settings changed from the console itself, e.g. which Telegram chat the
-- alerts go to (telegram_chat_id). A setting that isn't here falls back to its secret.
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server functions write with the service role after checking the user is an admin.
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view app settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));
