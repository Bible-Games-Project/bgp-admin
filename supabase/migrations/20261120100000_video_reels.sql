-- Weekly reels on the Videos page (src/lib/video-reels.ts). Each game can have a weekly
-- brief: on Sunday night the console asks the game's Videos conversation for next week's
-- reels, in the format the team set, and keeps the plan Claude answers with. Recording,
-- voice and scheduling in Metricool come next; until then the team reviews the plan.

-- A game's reel settings: whether the weekly brief runs, the format Claude follows, and
-- (later) the Metricool brand the reels are scheduled in.
CREATE TABLE public.video_settings (
  app_id uuid PRIMARY KEY REFERENCES public.apps(id) ON DELETE CASCADE,
  weekly_reels boolean NOT NULL DEFAULT false,
  format text NOT NULL DEFAULT '',
  metricool_blog_id text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_settings_format_length CHECK (char_length(format) <= 4000)
);

-- The reels Claude planned, one row per reel and day.
CREATE TABLE public.video_reels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  -- The message whose answer planned it.
  turn_id uuid REFERENCES public.agent_turns(id) ON DELETE SET NULL,
  -- The Monday of the week it belongs to, and the day it should come out.
  week_of date NOT NULL,
  publish_on date NOT NULL,
  title text NOT NULL,
  hook text NOT NULL DEFAULT '',
  -- What is on screen, shot by shot, as Claude wrote it.
  script text NOT NULL DEFAULT '',
  voiceover text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_reels_status_check CHECK (status IN ('planned', 'discarded'))
);

CREATE INDEX video_reels_app_week ON public.video_reels (app_id, week_of);

-- Only the server reads and writes these, with the service role, after checking the person
-- is an admin (videos.functions.ts).
REVOKE ALL ON public.video_settings, public.video_reels FROM anon, authenticated;
GRANT ALL ON public.video_settings, public.video_reels TO service_role;
ALTER TABLE public.video_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_reels ENABLE ROW LEVEL SECURITY;
