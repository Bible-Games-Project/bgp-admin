
ALTER FUNCTION public.revenue_stats(uuid, public.purchase_platform, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.revenue_timeseries(uuid, public.purchase_platform, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.revenue_by_platform(uuid, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.revenue_by_app(public.purchase_platform, timestamptz, timestamptz) SECURITY INVOKER;
ALTER FUNCTION public.top_products(uuid, public.purchase_platform, timestamptz, timestamptz, int) SECURITY INVOKER;

REVOKE EXECUTE ON FUNCTION public.revenue_stats(uuid, public.purchase_platform, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revenue_timeseries(uuid, public.purchase_platform, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revenue_by_platform(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revenue_by_app(public.purchase_platform, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.top_products(uuid, public.purchase_platform, timestamptz, timestamptz, int) FROM PUBLIC, anon;
