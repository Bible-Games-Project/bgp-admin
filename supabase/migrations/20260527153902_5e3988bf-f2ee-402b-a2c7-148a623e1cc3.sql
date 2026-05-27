CREATE TABLE public.admins (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admins TO authenticated;
GRANT ALL ON public.admins TO service_role;

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own admin row"
ON public.admins
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);