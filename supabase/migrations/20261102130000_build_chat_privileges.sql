-- This project gives anon and authenticated every privilege on new tables in public by
-- default (Supabase's default privileges), so the grants in 20261102120000_build_chat.sql
-- only added to them and RLS was the one thing keeping the Build chat's tables closed.
-- Take back what these tables don't need: anon gets nothing, admins only read (writes go
-- through the service role), and a sign-in's code and pasted token (there for seconds,
-- until the build server takes them) can't be read even by admins.
REVOKE ALL ON public.agent_chats, public.agent_turns, public.agent_events,
  public.agent_logins, public.agent_runner, public.agent_repo_keys FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.agent_chats,
  public.agent_turns, public.agent_events, public.agent_logins, public.agent_runner,
  public.agent_repo_keys FROM authenticated;

REVOKE SELECT ON public.agent_logins FROM authenticated;
GRANT SELECT (id, mode, status, url, error, created_by, created_by_email, created_at, updated_at)
  ON public.agent_logins TO authenticated;
