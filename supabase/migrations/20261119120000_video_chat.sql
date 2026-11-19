-- The Videos page (src/lib/videos.ts): one conversation with Claude about each game's videos,
-- shared by the team like the game's Build chat. It runs on the build server like Ruben's
-- messages (no repository; the console's read-only tools), as chats of kind 'video' that carry
-- the game's app_id. Their turns have no app_id, so they never hold up the game's Build chat.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.agent_chats'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.agent_chats DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.agent_chats
  ADD CONSTRAINT agent_chats_kind_check
    CHECK (kind IN ('build', 'assistant', 'translate', 'video')),
  ADD CONSTRAINT agent_chats_kind_fields CHECK (
    (kind IN ('build', 'video') AND app_id IS NOT NULL)
    OR (kind IN ('assistant', 'translate') AND user_id IS NOT NULL)
  );

-- One open chat per game and kind: a game has its Build chat and its Videos chat.
DROP INDEX IF EXISTS public.agent_chats_one_open_per_app;
CREATE UNIQUE INDEX agent_chats_one_open_per_app
  ON public.agent_chats (app_id) WHERE kind = 'build' AND archived_at IS NULL;
CREATE UNIQUE INDEX agent_chats_one_video_per_app
  ON public.agent_chats (app_id) WHERE kind = 'video' AND archived_at IS NULL;
