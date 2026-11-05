-- Internet and keys for the Build chat (Settings → Claude), like the cloud environment of
-- Claude Code on the web: the sites Claude may reach besides the Claude API and npm, and
-- the variables (API keys: OpenAI for images, ElevenLabs for voices…) its sessions get.
-- Both live on the build server (agent-runner/, environment.json), like the Claude token.
-- The console keeps what the server reports and relays each change once.

-- What the server holds: { domains, variables: [{ name, last4 }], updatedAt, updatedBy }.
-- Never a value. Readable by admins like the rest of the row.
ALTER TABLE public.agent_runner ADD COLUMN environment jsonb;

-- A change saved in Settings → Claude on its way to the build server. The values in
-- set_variables are only here until the server takes them (status 'sending'): they're
-- cleared then, and the server answers with what it holds now (/api/agent/environment).
CREATE TABLE public.agent_environment_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The whole list of sites, replacing the current one; null leaves the sites as they are.
  domains text[],
  -- Sites to add or take out (connecting or disconnecting a service such as OpenAI).
  add_domains text[] NOT NULL DEFAULT '{}',
  remove_domains text[] NOT NULL DEFAULT '{}',
  -- { NAME: value } to add or replace.
  set_variables jsonb,
  remove_variables text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'applied', 'failed')),
  error text,
  -- What the server left out, and why ("NAME: is set by the build server itself").
  skipped text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_environment_changes_open ON public.agent_environment_changes (created_at)
  WHERE status IN ('pending', 'sending');

-- New tables in public are open to anon and authenticated by default here, and the values
-- must not be readable by anyone: only the service role, through server functions that
-- check the user is an admin (and never return a value).
REVOKE ALL ON public.agent_environment_changes FROM anon, authenticated;
GRANT ALL ON public.agent_environment_changes TO service_role;
ALTER TABLE public.agent_environment_changes ENABLE ROW LEVEL SECURITY;
