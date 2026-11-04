// What Ruben's tools read: /api/assistant/tools (what there is) and /api/assistant/call
// (one of them). The build server's MCP server (agent-runner/console-mcp.mjs) calls these
// with the token of the turn it runs, which the console made when it handed the turn out
// (agent.server.ts) and clears when the turn ends. Everything is read with the service
// role; nothing here changes anything: changes go through the actions the chat shows as
// buttons (src/lib/assistant.ts). See src/lib/assistant.ts for the whole picture.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  AGENT_SETTING_KEYS,
  accountFrom,
  agentSettingsFrom,
  runnerView,
  sameSecret,
} from "@/lib/agent";
import { weeklyBudgetNow } from "@/lib/agent.server";
import { appStoreIds, isWebGame } from "@/lib/app-kind";
import { loadDownloads } from "@/lib/downloads.functions";
import { downloadBuckets } from "@/lib/downloads";
import { readExpenses } from "@/lib/expenses.server";
import { monthlyShare, periodProfit, priceLabel } from "@/lib/expenses";
import { loadHome } from "@/lib/home.functions";
import { readIncome } from "@/lib/income-sync.server";
import { byApp } from "@/lib/income";
import type { AppStoreState, DeploysState, ReviewsState } from "@/lib/monitor";

const db = () => supabaseAdmin as any;

class AssistantApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The turn a token belongs to, as long as it's running. */
async function authorize(request: Request) {
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!/^ast_[0-9a-f]{64}$/.test(given)) throw new AssistantApiError("Unauthorized", 401);
  const { data: turn } = await db()
    .from("agent_turns")
    .select("id, chat_id, status, tool_token")
    .eq("tool_token", given)
    .maybeSingle();
  if (!turn || turn.status !== "running" || !sameSecret(turn.tool_token, given))
    throw new AssistantApiError("Unauthorized", 401);
  return turn as { id: string; chat_id: string };
}

const excerpt = (text: unknown, max: number) =>
  typeof text === "string" && text.length > max ? `${text.slice(0, max)}…` : (text ?? null);

type Tool = {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  input: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

const noArgs = { type: "object", properties: {}, additionalProperties: false };
const appIdArg = {
  type: "object",
  properties: { appId: { type: "string", description: "The app's id (from apps)" } },
  required: ["appId"],
  additionalProperties: false,
};

async function appRow(appId: unknown) {
  if (typeof appId !== "string" || !/^[0-9a-f-]{36}$/i.test(appId))
    throw new AssistantApiError("appId must be an app's id (from the apps tool)");
  const { data: app } = await db().from("apps").select("*").eq("id", appId).maybeSingle();
  if (!app) throw new AssistantApiError("No app has that id");
  return app;
}

function appView(a: any) {
  const ids = appStoreIds(a);
  return {
    id: a.id,
    name: a.name,
    kind: isWebGame(a) ? "web game (built by the console)" : "made with another engine",
    repo: isWebGame(a) ? `${a.github_owner}/${a.github_repo}` : null,
    branch: a.default_ref,
    active: a.is_active,
    marketingVersion: a.marketing_version,
    ios: ids.ios,
    android: ids.android,
    steam: ids.steam,
    demoOf: a.full_game_id ?? null,
    notes: a.notes,
    createdAt: a.created_at,
  };
}

const TOOLS: Tool[] = [
  {
    name: "home",
    description:
      "What Home shows: what needs attention now (each item with its actions; an item with a version waiting for release carries its appId and versionId), what's coming up (expirations, deadlines), the month's profit so far, and each game at a glance.",
    input: noArgs,
    run: async () => {
      const { icons: _icons, ...home } = await loadHome(supabaseAdmin);
      return home;
    },
  },
  {
    name: "apps",
    description:
      "Every game in the console: id, name, kind (web game or another engine), repo, store ids, whether it's active.",
    input: noArgs,
    run: async () => {
      const { data } = await db().from("apps").select("*").order("name");
      return (data ?? []).map(appView);
    },
  },
  {
    name: "app",
    description:
      "One game in detail: its fields, which setup steps are done (web games), its latest deploy run, its App Store version state, and the last messages of its Build chat.",
    input: appIdArg,
    run: async ({ appId }) => {
      const app = await appRow(appId);
      const [{ data: steps }, { data: checks }, { data: chats }] = await Promise.all([
        db().from("app_setup_steps").select("step_key, completed_at").eq("app_id", app.id),
        db()
          .from("monitor_checks")
          .select("key, ran_at, state")
          .in("key", ["deploys", "app_store"]),
        db()
          .from("agent_chats")
          .select("id, created_at, archived_at")
          .eq("app_id", app.id)
          .eq("kind", "build")
          .is("archived_at", null)
          .maybeSingle(),
      ]);
      const deploys = (checks ?? []).find((c: any) => c.key === "deploys")?.state as
        | DeploysState
        | undefined;
      const appStore = (checks ?? []).find((c: any) => c.key === "app_store")?.state as
        | AppStoreState
        | undefined;
      const chat = chats as { id: string } | null;
      const { data: turns } = chat
        ? await db()
            .from("agent_turns")
            .select("prompt, status, reply, error, commits, pushed_sha, created_at")
            .eq("chat_id", chat.id)
            .order("created_at", { ascending: false })
            .limit(5)
        : { data: [] };
      return {
        ...appView(app),
        setupStepsDone: (steps ?? []).map((s: any) => s.step_key),
        latestDeploy: deploys?.apps?.[app.id] ?? null,
        appStore: appStore?.apps?.[app.id] ?? null,
        buildChat: (turns ?? []).reverse().map((t: any) => ({
          at: t.created_at,
          message: excerpt(t.prompt, 400),
          status: t.status,
          reply: excerpt(t.reply, 600),
          error: t.error,
          commits: t.commits,
          pushed: t.pushed_sha,
        })),
        deployWorkflows: isWebGame(app) ? ["deploy-ios.yml", "deploy-android.yml"] : [],
      };
    },
  },
  {
    name: "build_chat",
    description:
      "The last messages of a web game's Build chat: what was asked, what Claude replied, what it saved. Up to 20 messages.",
    input: {
      type: "object",
      properties: {
        appId: { type: "string", description: "The app's id" },
        count: { type: "number", description: "How many messages, 1 to 20 (default 10)" },
      },
      required: ["appId"],
      additionalProperties: false,
    },
    run: async ({ appId, count }) => {
      const app = await appRow(appId);
      const n = Math.min(20, Math.max(1, Number(count) || 10));
      const { data: chat } = await db()
        .from("agent_chats")
        .select("id")
        .eq("app_id", app.id)
        .eq("kind", "build")
        .is("archived_at", null)
        .maybeSingle();
      if (!chat) return { app: app.name, messages: [] };
      const { data: turns } = await db()
        .from("agent_turns")
        .select("prompt, status, reply, error, commits, pushed_sha, created_at, finished_at")
        .eq("chat_id", chat.id)
        .order("created_at", { ascending: false })
        .limit(n);
      return {
        app: app.name,
        messages: (turns ?? []).reverse().map((t: any) => ({
          at: t.created_at,
          message: t.prompt,
          status: t.status,
          reply: excerpt(t.reply, 2000),
          error: t.error,
          commits: t.commits,
          pushed: t.pushed_sha,
        })),
      };
    },
  },
  {
    name: "expenses",
    description:
      "The expenses (Expenses page): each with its price, frequency, dates and the app it's for, and what they add up to a month.",
    input: noArgs,
    run: async () => {
      const { expenses } = await readExpenses(db());
      const today = new Date().toISOString().slice(0, 10);
      const running = expenses.filter((e) => !e.ends_on || e.ends_on >= today);
      return {
        expenses: expenses.map((e) => ({
          id: e.id,
          name: e.name,
          price: priceLabel(e),
          amount: e.amount,
          currency: e.currency,
          frequency: e.frequency,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
          appId: e.app_id,
          notes: e.notes,
        })),
        monthlyShareOfRecurring: Object.fromEntries(
          (["EUR", "USD"] as const).map((currency) => [
            currency,
            Math.round(
              running
                .filter((e) => e.currency === currency && e.frequency !== "once")
                .reduce((sum, e) => sum + monthlyShare(e.frequency, e.amount), 0) * 100,
            ) / 100,
          ]),
        ),
      };
    },
  },
  {
    name: "revenue",
    description:
      "Income from the stores, expenses and profit (Revenue page), in euros: this month, last month and the last 12 months, plus the last 12 months by game, and any problem reading the stores' reports.",
    input: noArgs,
    run: async () => {
      const now = new Date();
      const [income, expenses] = await Promise.all([readIncome(db()), readExpenses(db())]);
      const period = (preset: "month" | "12m") => {
        const p = periodProfit(income.rows, expenses.payments, preset, now);
        return {
          incomeNetEur: Math.round(p.income.netEur * 100) / 100,
          units: p.income.units,
          refunds: p.income.refunds,
          estimated: p.income.estimated,
          spentEur: Math.round(p.spent * 100) / 100,
          profitEur: Math.round(p.profit * 100) / 100,
        };
      };
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const lastMonthKey = lastMonth.toISOString().slice(0, 7);
      const lastRows = income.rows.filter((r) => r.period === lastMonthKey);
      return {
        thisMonth: period("month"),
        lastMonth: {
          month: lastMonthKey,
          incomeNetEur: Math.round(lastRows.reduce((sum, r) => sum + r.netEur, 0) * 100) / 100,
          units: lastRows.reduce((sum, r) => sum + r.units, 0),
        },
        last12Months: period("12m"),
        byGameLast12Months: byApp(periodProfit(income.rows, expenses.payments, "12m", now).rows),
        reportsCheckedAt: income.checkedAt,
        problems: income.syncProblems,
      };
    },
  },
  {
    name: "downloads",
    description:
      "Downloads (first installs) by month for the last 12 months, per store, and the games the console counts them for.",
    input: noArgs,
    run: async () => {
      const data = await loadDownloads(supabaseAdmin);
      return {
        byMonth: downloadBuckets(data.rows, "12m", new Date()),
        games: data.games,
        playProblem: data.playProblem,
        checkedAt: data.checkedAt,
      };
    },
  },
  {
    name: "reviews",
    description:
      "Ratings and recent reviews from the App Store, Google Play and Steam as the monitor job last saw them (Reviews page), with which ones await a reply.",
    input: {
      type: "object",
      properties: { appId: { type: "string", description: "Only this app (optional)" } },
      additionalProperties: false,
    },
    run: async ({ appId }) => {
      const { data: checks } = await db()
        .from("monitor_checks")
        .select("key, ran_at, state, problem")
        .in("key", ["reviews_app_store", "reviews_google_play", "reviews_steam"]);
      const { data: apps } = await db().from("apps").select("id, name");
      const names = new Map((apps ?? []).map((a: any) => [a.id, a.name]));
      return (checks ?? []).map((c: any) => {
        const state = c.state as ReviewsState | null;
        const entries = Object.entries(state?.apps ?? {}).filter(([id]) => !appId || id === appId);
        return {
          store: c.key.replace("reviews_", ""),
          checkedAt: c.ran_at,
          problem: c.problem,
          apps: entries.map(([id, s]) => ({ appId: id, app: names.get(id) ?? id, ...s })),
        };
      });
    },
  },
  {
    name: "settings",
    description:
      "Settings → Claude: the model and effort the chats use, the weekly share of the Claude account's limit and what's used, the account's usage as last read, and whether the build server is online.",
    input: noArgs,
    run: async () => {
      const [{ data: rows }, { data: runner }] = await Promise.all([
        db().from("app_settings").select("key, value").in("key", AGENT_SETTING_KEYS),
        db()
          .from("agent_runner")
          .select("last_seen_at, host, version, busy, account, usage")
          .eq("id", "main")
          .maybeSingle(),
      ]);
      const settings = agentSettingsFrom(rows ?? []);
      return {
        model: settings.model,
        effort: settings.effort,
        weeklyShare: await weeklyBudgetNow(settings.weeklyBudgetPercent, runner?.usage ?? null),
        accountUsage: runner?.usage ?? null,
        account: accountFrom(runner?.account),
        buildServer: runnerView(runner),
      };
    },
  },
];

/** The tools as the MCP server lists them. */
function toolList() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input }));
}

async function callTool(body: Record<string, unknown>) {
  const tool = TOOLS.find((t) => t.name === body.name);
  if (!tool) throw new AssistantApiError(`No tool named ${String(body.name).slice(0, 60)}`, 404);
  const args =
    body.arguments && typeof body.arguments === "object"
      ? (body.arguments as Record<string, unknown>)
      : {};
  return tool.run(args);
}

export async function handleAssistantRequest(path: string, request: Request) {
  try {
    await authorize(request);
    let body: Record<string, unknown> = {};
    if (path === "call") {
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        throw new AssistantApiError("The body must be JSON");
      }
      if (!body || typeof body !== "object")
        throw new AssistantApiError("The body must be a JSON object");
      return Response.json({ result: await callTool(body) });
    }
    if (path === "tools") return Response.json({ tools: toolList() });
    throw new AssistantApiError("Not found", 404);
  } catch (error) {
    const status = error instanceof AssistantApiError ? error.status : 500;
    if (status === 500) console.error(`[assistant] ${path}:`, error);
    return Response.json({ error: (error as Error).message }, { status });
  }
}
