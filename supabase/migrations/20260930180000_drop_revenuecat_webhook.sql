-- The RevenueCat webhook filled purchases / purchase_events, and the first Revenue page
-- read them through these functions. Since 2026-09-29 Revenue reads the stores' own
-- sales reports (income_reports), which include in-app purchases, so nothing reads or
-- writes any of this any more. The games still sell through RevenueCat's SDK; only the
-- console's copy of the events goes. The two rows it held (June 2026) are in the store
-- reports and in the nightly backups.
DROP FUNCTION IF EXISTS public.revenue_by_app(public.purchase_platform, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.revenue_by_platform(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.revenue_stats(uuid, public.purchase_platform, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.revenue_timeseries(uuid, public.purchase_platform, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.top_products(uuid, public.purchase_platform, timestamptz, timestamptz, integer);

DROP TABLE IF EXISTS public.purchase_events;
DROP TABLE IF EXISTS public.purchases;

DROP TYPE IF EXISTS public.purchase_platform;
DROP TYPE IF EXISTS public.purchase_product_type;
DROP TYPE IF EXISTS public.purchase_status;
DROP TYPE IF EXISTS public.purchase_environment;

-- Only the webhook used it, to tell which game an event belonged to.
DROP INDEX IF EXISTS public.apps_revenuecat_app_id_key;
ALTER TABLE public.apps DROP COLUMN IF EXISTS revenuecat_app_id;
