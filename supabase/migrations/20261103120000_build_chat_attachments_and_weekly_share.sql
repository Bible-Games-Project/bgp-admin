-- Two additions to the Build chat (20261102120000_build_chat.sql).
--
-- 1. Attachments: a message can carry files for Claude to look at (photos, PDFs, text
--    files). The file itself lives in Storage (bucket agent-attachments, private); this
--    row says what it is and which message it went with. The build server fetches it
--    before Claude starts, through a signed link the console puts in the turn, and puts
--    it where Claude can read it (/attachments). turn_id is null from the upload until
--    the message is sent; a row still unsent a day later is dropped with its file.
CREATE TABLE public.agent_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES public.agent_turns(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  content_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0),
  -- The object's path in the bucket: <app_id>/<id>/<name>.
  storage_path text NOT NULL,
  -- A small data: URL of an image, made in the browser, for the chat to show.
  thumbnail text CHECK (length(thumbnail) <= 60000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_attachments_turn ON public.agent_attachments (turn_id, created_at);
CREATE INDEX agent_attachments_unsent ON public.agent_attachments (app_id, created_at)
  WHERE turn_id IS NULL;

-- This project's default privileges open every new table to anon and authenticated
-- (20261102130000_build_chat_privileges.sql): admins read, the service role writes.
REVOKE ALL ON public.agent_attachments FROM anon, authenticated;
GRANT SELECT ON public.agent_attachments TO authenticated;
GRANT ALL ON public.agent_attachments TO service_role;

ALTER TABLE public.agent_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view agent attachments" ON public.agent_attachments
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- The bucket. Only the service role touches it (no policies on storage.objects): the
-- browser uploads through a server function and gets signed links to open a file.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('agent-attachments', 'agent-attachments', false, 20971520)
ON CONFLICT (id) DO NOTHING;

-- 2. The weekly share: what each message used of the Claude account's weekly limit,
--    as Claude reported the account's usage before and after it (a difference, in
--    percent), and the window it counts in. Settings → Claude caps what the Build chat
--    may use per week; the sum of weekly_spent in the current window is what it has
--    used (src/lib/agent.ts, weeklyBudgetFrom).
ALTER TABLE public.agent_turns
  ADD COLUMN weekly_spent numeric,
  ADD COLUMN weekly_resets_at timestamptz;

CREATE INDEX agent_turns_weekly_window ON public.agent_turns (weekly_resets_at)
  WHERE weekly_resets_at IS NOT NULL;
