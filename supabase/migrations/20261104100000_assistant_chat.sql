-- Rafa, the console's assistant: a chat on every page (src/lib/assistant.ts). It runs on the
-- build server like the Build chat and keeps its conversations in the same tables, as chats
-- of kind 'assistant': one open chat per person instead of per app, with no app and no
-- repository. Each message carries where the person was (context), and while the build
-- server runs it, a one-off token (tool_token) lets Claude's tools read the console
-- through /api/assistant/* (assistant.server.ts).
ALTER TABLE public.agent_chats
  ADD COLUMN kind text NOT NULL DEFAULT 'build' CHECK (kind IN ('build', 'assistant')),
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ALTER COLUMN app_id DROP NOT NULL,
  ADD CONSTRAINT agent_chats_kind_fields CHECK (
    (kind = 'build' AND app_id IS NOT NULL) OR (kind = 'assistant' AND user_id IS NOT NULL)
  );

CREATE UNIQUE INDEX agent_chats_one_open_per_user
  ON public.agent_chats (user_id) WHERE kind = 'assistant' AND archived_at IS NULL;

ALTER TABLE public.agent_turns
  ALTER COLUMN app_id DROP NOT NULL,
  -- Where the person was when they wrote: { path, title, appId, appName, tab, ranActions }.
  ADD COLUMN context jsonb,
  -- Set while the build server runs an assistant turn; cleared when it ends.
  ADD COLUMN tool_token text;

CREATE INDEX agent_turns_tool_token ON public.agent_turns (tool_token)
  WHERE tool_token IS NOT NULL;

ALTER TABLE public.agent_events ALTER COLUMN app_id DROP NOT NULL;

-- The token is for the build server only: admins read everything else.
REVOKE SELECT ON public.agent_turns FROM authenticated;
GRANT SELECT (id, chat_id, app_id, prompt, status, created_by, created_by_email, created_at,
  started_at, finished_at, cancel_requested_at, reply, error, commits, pushed_sha, usage,
  weekly_spent, weekly_resets_at, context) ON public.agent_turns TO authenticated;
