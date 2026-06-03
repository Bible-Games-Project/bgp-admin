# In-App Purchase Tracking Dashboard

## 1. Database (Supabase migration)

Two new tables in `public`, with enums, indexes, RLS and GRANTs.

**Enums**
- `purchase_platform`: `ios`, `android`
- `purchase_product_type`: `consumable`, `non_consumable`, `subscription`, `auto_renewable_subscription`
- `purchase_status`: `active`, `cancelled`, `refunded`, `expired`
- `purchase_environment`: `production`, `sandbox`

**Table `purchases`**
- `id uuid pk default gen_random_uuid()`
- `app_id uuid not null references public.apps(id) on delete cascade`
- `transaction_id text not null unique`
- `platform purchase_platform not null`
- `product_id text not null`
- `product_type purchase_product_type not null`
- `purchase_date timestamptz not null`
- `revenue_usd numeric(12,4) not null default 0`
- `local_currency text`
- `local_amount numeric(14,4)`
- `user_id text` (app's user id, nullable)
- `status purchase_status not null default 'active'`
- `subscription_expires_at timestamptz`
- `environment purchase_environment not null default 'production'`
- `raw_payload jsonb not null default '{}'::jsonb`
- `created_at`, `updated_at` (with `update_updated_at_column` trigger)
- Indexes on `(app_id)`, `(purchase_date desc)`, `(platform)`, `(status)`, `(product_id)`

**Table `purchase_events`**
- `id uuid pk`
- `purchase_id uuid not null references public.purchases(id) on delete cascade`
- `event_type text not null`
- `event_date timestamptz not null`
- `platform purchase_platform not null`
- `raw_data jsonb not null default '{}'::jsonb`
- `created_at`
- Indexes on `(purchase_id)`, `(event_date desc)`

**Access control**
- RLS enabled on both tables.
- Read-only for authenticated users (any signed-in admin can view all data — same pattern as `apps`, gated by `is_admin(auth.uid())`).
- No INSERT/UPDATE/DELETE policies from clients (purchases come from webhooks → `service_role`).
- GRANTs: `SELECT` to `authenticated`; `ALL` to `service_role`.

> Note: webhook ingestion endpoint is **not** part of this scope — tables are read-only from the app for now. We can add `/api/public/webhooks/*` ingest routes in a follow-up.

## 2. Route `/_authenticated/revenue`

New file `src/routes/_authenticated.revenue.tsx`. Gated by existing `_authenticated` layout + admin check (same pattern as dashboard).

### Layout
- Header: title "Revenue" + filter bar (date range preset, app select, platform select).
- Stats row (4 cards): Total Revenue, This Month (+ % vs last month), Active Subscriptions, MRR.
- Charts grid:
  - Revenue over time (line, last 90d by day)
  - Revenue by platform (donut, iOS vs Android)
  - Revenue by app (bar)
  - Top products (table: product_id, count, revenue)
- Recent transactions table with pagination (10/page) + row click → Dialog with raw_payload JSON.

### Filters
URL-driven via `validateSearch` (date preset, appId, platform, page). Date presets: `7d | 30d | 90d | all`.

### Components (shadcn + recharts already present)
- `Card`, `Select`, `Table`, `Badge`, `Dialog`, `Popover` — all already in repo.
- Charts via `src/components/ui/chart.tsx` + `recharts`.
- Date filter implemented as preset `Select` (no extra date picker dep needed for v1).

## 3. Server functions

New `src/lib/revenue.functions.ts` (all protected with `requireSupabaseAuth`, admin-checked inside handler):

- `getRevenueStats({ filters })` → `{ totalUsd, monthUsd, prevMonthUsd, monthChangePct, activeSubs, mrrUsd }`
- `getRevenueTimeseries({ filters })` → `[{ date, revenueUsd }]`
- `getRevenueByPlatform({ filters })` → `[{ platform, revenueUsd }]`
- `getRevenueByApp({ filters })` → `[{ appId, appName, revenueUsd }]`
- `getTopProducts({ filters, limit })` → `[{ productId, count, revenueUsd }]`
- `getRecentPurchases({ filters, limit, offset })` → `{ rows, total }`

Aggregations done in SQL via RPC functions (created in the same migration) to avoid pulling raw rows:
- `revenue_timeseries(p_app uuid, p_platform text, p_from timestamptz, p_to timestamptz)`
- `revenue_by_platform(...)`, `revenue_by_app(...)`, `top_products(..., p_limit int)`
- `revenue_stats(...)` returning a single row.

MRR = sum of latest active subscription revenue normalized to monthly (for v1, treat each active `auto_renewable_subscription` / `subscription` row's `revenue_usd` as its monthly value).

All hooks use TanStack Query (`ensureQueryData` in loader for stats + timeseries; `useQuery` for the paginated table).

## 4. Navigation

Add a `Revenue` entry to `src/components/AppSidebar.tsx` with `DollarSign` icon from `lucide-react`, linking to `/revenue`.

## 5. Types

Supabase types are auto-regenerated after the migration; revenue DTOs typed in `revenue.functions.ts`.

## Open questions before I build

1. **MRR definition** — OK with the simple v1 above (sum of `revenue_usd` of active subscription rows treated as monthly)? Or do you want yearly-vs-monthly product split (needs a `billing_period` field, not in your spec)?
2. **Seed data** — Want me to insert a small set of fake purchases so the dashboard isn't empty on first load?
3. **Webhook ingestion** — Confirm out of scope for this task (table will be empty until you wire Apple/Google webhooks).

Reply with answers (or "go" to accept defaults: simple MRR, no seed, no webhooks) and I'll implement.