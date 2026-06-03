
-- Enums
CREATE TYPE public.purchase_platform AS ENUM ('ios','android');
CREATE TYPE public.purchase_product_type AS ENUM ('consumable','non_consumable','subscription','auto_renewable_subscription');
CREATE TYPE public.purchase_status AS ENUM ('active','cancelled','refunded','expired');
CREATE TYPE public.purchase_environment AS ENUM ('production','sandbox');

-- purchases
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  transaction_id text NOT NULL UNIQUE,
  platform public.purchase_platform NOT NULL,
  product_id text NOT NULL,
  product_type public.purchase_product_type NOT NULL,
  purchase_date timestamptz NOT NULL,
  revenue_usd numeric(12,4) NOT NULL DEFAULT 0,
  local_currency text,
  local_amount numeric(14,4),
  user_id text,
  status public.purchase_status NOT NULL DEFAULT 'active',
  subscription_expires_at timestamptz,
  environment public.purchase_environment NOT NULL DEFAULT 'production',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view purchases" ON public.purchases
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE INDEX idx_purchases_app_id ON public.purchases(app_id);
CREATE INDEX idx_purchases_purchase_date ON public.purchases(purchase_date DESC);
CREATE INDEX idx_purchases_platform ON public.purchases(platform);
CREATE INDEX idx_purchases_status ON public.purchases(status);
CREATE INDEX idx_purchases_product_id ON public.purchases(product_id);

CREATE TRIGGER trg_purchases_updated_at
  BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- purchase_events
CREATE TABLE public.purchase_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_date timestamptz NOT NULL,
  platform public.purchase_platform NOT NULL,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.purchase_events TO authenticated;
GRANT ALL ON public.purchase_events TO service_role;

ALTER TABLE public.purchase_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view purchase_events" ON public.purchase_events
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE INDEX idx_purchase_events_purchase_id ON public.purchase_events(purchase_id);
CREATE INDEX idx_purchase_events_event_date ON public.purchase_events(event_date DESC);

-- Aggregation functions
CREATE OR REPLACE FUNCTION public.revenue_stats(
  p_app uuid DEFAULT NULL,
  p_platform public.purchase_platform DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS TABLE(
  total_usd numeric,
  month_usd numeric,
  prev_month_usd numeric,
  active_subs bigint,
  mrr_usd numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT * FROM public.purchases
    WHERE (p_app IS NULL OR app_id = p_app)
      AND (p_platform IS NULL OR platform = p_platform)
      AND (p_from IS NULL OR purchase_date >= p_from)
      AND (p_to IS NULL OR purchase_date < p_to)
  )
  SELECT
    COALESCE(SUM(revenue_usd),0) AS total_usd,
    COALESCE(SUM(revenue_usd) FILTER (
      WHERE purchase_date >= date_trunc('month', now())
    ),0) AS month_usd,
    COALESCE(SUM(revenue_usd) FILTER (
      WHERE purchase_date >= date_trunc('month', now()) - interval '1 month'
        AND purchase_date < date_trunc('month', now())
    ),0) AS prev_month_usd,
    COUNT(*) FILTER (
      WHERE status = 'active'
        AND product_type IN ('subscription','auto_renewable_subscription')
    ) AS active_subs,
    COALESCE(SUM(revenue_usd) FILTER (
      WHERE status = 'active'
        AND product_type IN ('subscription','auto_renewable_subscription')
    ),0) AS mrr_usd
  FROM base;
$$;

CREATE OR REPLACE FUNCTION public.revenue_timeseries(
  p_app uuid DEFAULT NULL,
  p_platform public.purchase_platform DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS TABLE(day date, revenue_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc('day', purchase_date)::date AS day,
         SUM(revenue_usd) AS revenue_usd
  FROM public.purchases
  WHERE (p_app IS NULL OR app_id = p_app)
    AND (p_platform IS NULL OR platform = p_platform)
    AND (p_from IS NULL OR purchase_date >= p_from)
    AND (p_to IS NULL OR purchase_date < p_to)
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.revenue_by_platform(
  p_app uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS TABLE(platform public.purchase_platform, revenue_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT platform, SUM(revenue_usd) AS revenue_usd
  FROM public.purchases
  WHERE (p_app IS NULL OR app_id = p_app)
    AND (p_from IS NULL OR purchase_date >= p_from)
    AND (p_to IS NULL OR purchase_date < p_to)
  GROUP BY platform
  ORDER BY revenue_usd DESC;
$$;

CREATE OR REPLACE FUNCTION public.revenue_by_app(
  p_platform public.purchase_platform DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS TABLE(app_id uuid, app_name text, revenue_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id AS app_id, a.name AS app_name, COALESCE(SUM(p.revenue_usd),0) AS revenue_usd
  FROM public.apps a
  LEFT JOIN public.purchases p ON p.app_id = a.id
    AND (p_platform IS NULL OR p.platform = p_platform)
    AND (p_from IS NULL OR p.purchase_date >= p_from)
    AND (p_to IS NULL OR p.purchase_date < p_to)
  GROUP BY a.id, a.name
  ORDER BY revenue_usd DESC;
$$;

CREATE OR REPLACE FUNCTION public.top_products(
  p_app uuid DEFAULT NULL,
  p_platform public.purchase_platform DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 10
) RETURNS TABLE(product_id text, count bigint, revenue_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT product_id, COUNT(*) AS count, SUM(revenue_usd) AS revenue_usd
  FROM public.purchases
  WHERE (p_app IS NULL OR app_id = p_app)
    AND (p_platform IS NULL OR platform = p_platform)
    AND (p_from IS NULL OR purchase_date >= p_from)
    AND (p_to IS NULL OR purchase_date < p_to)
  GROUP BY product_id
  ORDER BY revenue_usd DESC
  LIMIT p_limit;
$$;
