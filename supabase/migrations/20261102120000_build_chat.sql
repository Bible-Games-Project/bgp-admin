-- The Build chat: a chat with Claude for each web game, next to the game's Cloudflare
-- preview (/apps/<id>/build). Claude doesn't run on the Worker: the build server
-- (agent-runner/, a service on a machine of our own) asks the console for work through
-- /api/agent/* and runs the Claude CLI on the game's repo. The console only keeps the
-- conversation; the server keeps the Claude account and the repos.
--
-- Everything here is written with the service role: by the server functions after
-- checking the user is an admin, and by the /api/agent/* routes for the build server.
-- Admins read it, also through Realtime, so the chat updates as Claude works.

-- One conversation with Claude about a game. "New chat" archives the open one, and
-- the next message starts a fresh Claude session.
CREATE TABLE public.agent_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  -- The Claude Code session the build server resumes for the next message.
  session_id text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE UNIQUE INDEX agent_chats_one_open_per_app
  ON public.agent_chats (app_id) WHERE archived_at IS NULL;

-- Each message sent in a chat, and what came of it.
CREATE TABLE public.agent_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.agent_chats(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  prompt text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 20000),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  cancel_requested_at timestamptz,
  -- Claude's last words to the person, and why the turn failed when it did.
  reply text,
  error text,
  -- How many commits Claude made, and the commit pushed to the game's branch. The
  -- page follows that commit's preview deploy and reloads the preview when it's live.
  commits integer NOT NULL DEFAULT 0,
  pushed_sha text,
  -- The Claude account's usage after the turn: { fiveHour, weekly } (agent-runner/lib.mjs).
  usage jsonb
);

CREATE INDEX agent_turns_chat ON public.agent_turns (chat_id, created_at);
CREATE INDEX agent_turns_pending ON public.agent_turns (created_at)
  WHERE status IN ('queued', 'running');

-- What Claude did during a turn, in order, as the build server reports it: what it
-- said ('text', { text }) and each thing it did ('step', { tool, label }).
CREATE TABLE public.agent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  turn_id uuid NOT NULL REFERENCES public.agent_turns(id) ON DELETE CASCADE,
  -- Repeated from the turn so the page can listen to one game's events.
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('text', 'step')),
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_events_turn ON public.agent_events (turn_id, id);

-- Linking a Claude account from Settings. mode 'link': the build server runs
-- `claude setup-token`, the page shows the claude.ai link it prints (url), and the code
-- claude.ai gives back goes to the server (code). mode 'token': a token made with
-- `claude setup-token` in a terminal, pasted in Settings. The code and the token are
-- cleared as soon as the server has them; the token itself only lives on the server.
CREATE TABLE public.agent_logins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'link' CHECK (mode IN ('link', 'token')),
  status text NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'waiting_code', 'checking', 'linked', 'failed', 'cancelled')),
  url text,
  code text,
  token text,
  error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The build server, as it last reported in. One row.
CREATE TABLE public.agent_runner (
  id text PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  last_seen_at timestamptz,
  host text,
  version text,
  busy boolean NOT NULL DEFAULT false,
  -- The Claude account the server holds: { last4, linkedAt, linkedBy, rejectedAt }.
  -- Never the token.
  account jsonb,
  -- The account's usage as of the last turn: { fiveHour, weekly }.
  usage jsonb,
  -- Someone has the Build chat or the Claude settings open until then: the server asks
  -- for work every couple of seconds instead of every few.
  watched_until timestamptz,
  -- Set by "Unlink" in Settings; the server forgets the account on its next poll.
  unlink_requested_at timestamptz
);

INSERT INTO public.agent_runner (id) VALUES ('main');

-- The deploy key the build server pushes to each game repo with (one per repo: GitHub
-- doesn't let two repos share one). The server makes the key; the console adds it to
-- the repo with GITHUB_PAT.
CREATE TABLE public.agent_repo_keys (
  -- "owner/name", lower case.
  repo text PRIMARY KEY,
  public_key text NOT NULL,
  github_key_id bigint,
  registered_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.agent_chats, public.agent_turns, public.agent_events,
  public.agent_runner, public.agent_repo_keys TO authenticated;
-- Not the code or the token, even for the few seconds they're there.
GRANT SELECT (id, mode, status, url, error, created_by, created_by_email, created_at, updated_at)
  ON public.agent_logins TO authenticated;
GRANT ALL ON public.agent_chats, public.agent_turns, public.agent_events,
  public.agent_logins, public.agent_runner, public.agent_repo_keys TO service_role;

ALTER TABLE public.agent_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runner ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_repo_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view agent chats" ON public.agent_chats
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view agent turns" ON public.agent_turns
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view agent events" ON public.agent_events
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view agent logins" ON public.agent_logins
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view the agent runner" ON public.agent_runner
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view agent repo keys" ON public.agent_repo_keys
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- The page listens to these through Realtime. It also polls, so the chat still works
-- if Realtime is off.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_turns, public.agent_events;
  END IF;
END $$;
