-- The order of the Apps list, set by dragging the cards (0 = first card).
-- Apps without one, such as one created after the last drag, come last, oldest first.
ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS sort_order integer;

-- Saves a whole new order in one statement: the apps listed get 0, 1, 2… in that
-- order. It runs as the caller, so the "Admins can update apps" policy still decides
-- who may change it.
CREATE OR REPLACE FUNCTION public.reorder_apps(_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.apps AS a
  SET sort_order = o.pos - 1
  FROM unnest(_ids) WITH ORDINALITY AS o(id, pos)
  WHERE a.id = o.id;
$$;

-- New functions are executable by everyone by default; only signed-in admins use it.
REVOKE ALL ON FUNCTION public.reorder_apps(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_apps(uuid[]) TO authenticated;
