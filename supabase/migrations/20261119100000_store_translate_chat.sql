-- "Translate with Claude" on the Store tab (src/lib/store-translate.ts): each translation is
-- a short turn on the build server, kept in a chat of kind 'translate', one per person like
-- the assistant's. Its turns have no app_id (so they never hold up a game's Build chat);
-- the app, store and languages are in the turn's context.
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
  ADD CONSTRAINT agent_chats_kind_check CHECK (kind IN ('build', 'assistant', 'translate')),
  ADD CONSTRAINT agent_chats_kind_fields CHECK (
    (kind = 'build' AND app_id IS NOT NULL)
    OR (kind IN ('assistant', 'translate') AND user_id IS NOT NULL)
  );

CREATE UNIQUE INDEX agent_chats_one_translate_per_user
  ON public.agent_chats (user_id) WHERE kind = 'translate' AND archived_at IS NULL;
