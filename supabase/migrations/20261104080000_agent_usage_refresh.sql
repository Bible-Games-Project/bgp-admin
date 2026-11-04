-- The account's usage (agent_runner.usage) only changed when a Build chat message ran,
-- and the pages showed it as if it were current. Now the console can ask the build server
-- for a fresh reading: it sets this, the server answers its next poll with a tiny Claude
-- call that reports the account's limits, and /api/agent/usage stores the result.
ALTER TABLE public.agent_runner ADD COLUMN usage_requested_at timestamptz;
