
CREATE TABLE public.app_setup_steps (
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (app_id, step_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_setup_steps TO authenticated;
GRANT ALL ON public.app_setup_steps TO service_role;

ALTER TABLE public.app_setup_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view setup steps"
  ON public.app_setup_steps FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert setup steps"
  ON public.app_setup_steps FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update setup steps"
  ON public.app_setup_steps FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete setup steps"
  ON public.app_setup_steps FOR DELETE
  TO authenticated
  USING (public.is_admin(auth.uid()));
