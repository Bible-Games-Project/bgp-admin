-- How each published reel is doing on each network (src/lib/reel-metrics.ts), for the
-- Published tab of the Videos page. Upload-Post gives the metrics with the team's API key.

-- The team's Upload-Post API key, pasted once on the Videos page. Only the server reads it
-- (service role); the page sees whether there is one and its last four characters.
CREATE TABLE public.upload_post_account (
  id text PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  api_key text NOT NULL,
  last4 text NOT NULL,
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  -- The last time Upload-Post turned the key down (401), so the page can say it.
  rejected_at timestamptz
);

-- One row per scheduled post (Upload-Post job): its request id once known, and the numbers of
-- each network, as the page shows them ({ youtube: { views, likes, … }, … }).
CREATE TABLE public.video_reel_metrics (
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  job_id text NOT NULL,
  request_id text,
  platforms jsonb NOT NULL DEFAULT '{}',
  error text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, job_id)
);

-- New tables in public are open to anon and authenticated by default here: only the server
-- reads and writes these, with the service role, after checking the person is an admin.
REVOKE ALL ON public.upload_post_account, public.video_reel_metrics FROM anon, authenticated;
GRANT ALL ON public.upload_post_account, public.video_reel_metrics TO service_role;
ALTER TABLE public.upload_post_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_reel_metrics ENABLE ROW LEVEL SECURITY;
