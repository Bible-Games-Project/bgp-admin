// Ruben, the console's assistant: a chat
// on every page, for the person to ask about what they are looking at and to get things
// done. Claude runs on the build server (agent-runner/), with no repository: it reads the
// console through the tools /api/assistant/* answers (assistant.server.ts), and proposes
// actions, which the chat shows as buttons the person presses: the console then does the
// thing as the person, with its own server functions. Claude never changes anything itself.
// Shared by the page (components/assistant/), the server functions and the build server's
// prompts (agent-runner/lib.mjs mirrors ACTION_DOCS).

export const ASSISTANT_NAME = "Ruben";

/** Where the person is when they write, sent with each message. */
export type PageContext = {
  /** The route's path, e.g. /apps/1234 */
  path: string;
  /** What the browser tab says. */
  title?: string;
  /** On an app's pages. */
  appId?: string;
  appName?: string;
  /** The app page's open tab (?tab=). */
  tab?: string;
  /** Actions the person pressed since their last message: label and what came of it. */
  ranActions?: { label: string; outcome: string }[];
};

const short = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

/** What a page may send as context; anything else is dropped. */
export function cleanContext(raw: unknown): PageContext {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const context: PageContext = { path: short(r.path, 300) ?? "/" };
  const title = short(r.title, 200);
  const appId = short(r.appId, 64);
  const appName = short(r.appName, 100);
  const tab = short(r.tab, 40);
  if (title) context.title = title;
  if (appId && /^[0-9a-f-]{36}$/i.test(appId)) context.appId = appId;
  if (appName) context.appName = appName;
  if (tab) context.tab = tab;
  if (Array.isArray(r.ranActions)) {
    const ran = r.ranActions
      .slice(0, 10)
      .map((a) => ({
        label: short((a as { label?: unknown })?.label, 120),
        outcome: short((a as { outcome?: unknown })?.outcome, 300),
      }))
      .filter((a): a is { label: string; outcome: string } => Boolean(a.label && a.outcome));
    if (ran.length) context.ranActions = ran;
  }
  return context;
}

const PAGES: [RegExp, string][] = [
  [/^\/$/, "Home (what needs attention, what's coming up, the month's profit)"],
  [/^\/apps\/?$/, "the Apps list"],
  [/^\/apps\/setup$/, "the setup overview of all apps"],
  [/^\/apps\/[^/]+\/build$/, "the Build chat of a game"],
  [/^\/apps\/[^/]+$/, "an app's page"],
  [/^\/revenue$/, "Revenue (income, expenses and profit by month)"],
  [/^\/downloads$/, "Downloads"],
  [/^\/expenses$/, "Expenses"],
  [/^\/reviews$/, "Reviews"],
  [/^\/settings\/claude$/, "Settings → Claude"],
  [/^\/settings\/security$/, "Settings → Security"],
];

/** The context as the message tells it to Claude. */
export function describeContext(context: PageContext) {
  const page = PAGES.find(([re]) => re.test(context.path))?.[1] ?? context.path;
  const parts = [`The person is on ${page} (${context.path})`];
  if (context.appName || context.appId) {
    parts.push(
      `about the app ${context.appName ?? ""}${context.appId ? ` (id ${context.appId})` : ""}`.trim(),
    );
  }
  if (context.tab) parts.push(`on its ${context.tab} tab`);
  let text = `${parts.join(", ")}.`;
  if (context.ranActions?.length) {
    text += `\nSince their last message they pressed: ${context.ranActions
      .map((a) => `${a.label} → ${a.outcome}`)
      .join("; ")}.`;
  }
  return text;
}

// --- Actions ---------------------------------------------------------------------------------
//
// Claude proposes an action as a fenced block in its reply:
//
//   ```action
//   {"type": "build_chat", "label": "Ask the Build chat to fix the overlap", "appId": "…", "message": "…"}
//   ```
//
// The chat turns it into a button. What each type does, and with which server function, is in
// components/assistant/actions.tsx; this is their shape. Keep ACTION_DOCS, what Claude is
// told, in step with it (agent-runner/lib.mjs carries the same text for the system prompt).

export type AssistantAction =
  | { type: "open"; label: string; to: string }
  | { type: "build_chat"; label: string; appId: string; message: string }
  | { type: "run_checks"; label: string }
  | { type: "refresh_income"; label: string }
  | {
      type: "trigger_deploy";
      label: string;
      appId: string;
      workflowFile: string;
      inputs?: Record<string, string>;
    }
  | { type: "release_version"; label: string; appId: string; versionId: string }
  | {
      type: "setup_step";
      label: string;
      appId: string;
      step: "capacitor" | "preview_deploy" | "deploy_workflow";
    }
  | { type: "create_app"; label: string; name: string; repoName?: string; bundleId?: string }
  | {
      type: "save_expense";
      label: string;
      name: string;
      amount: number;
      currency: "EUR" | "USD";
      frequency: "once" | "monthly" | "yearly";
      startsOn: string;
      endsOn?: string;
      appId?: string;
      notes?: string;
    };

export const SETUP_STEPS = ["capacitor", "preview_deploy", "deploy_workflow"] as const;

/** The block's JSON as an action, or null when it isn't one the chat knows. */
export function parseAction(json: string): AssistantAction | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = short(r.label, 80);
  if (!label) return null;
  const str = (key: string, max = 200) => short(r[key], max);
  const uuid = (key: string) => {
    const v = str(key, 64);
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
  };
  switch (r.type) {
    case "open": {
      const to = str("to", 300);
      return to && to.startsWith("/") ? { type: "open", label, to } : null;
    }
    case "build_chat": {
      const appId = uuid("appId");
      const message = str("message", 10_000);
      return appId && message ? { type: "build_chat", label, appId, message } : null;
    }
    case "run_checks":
      return { type: "run_checks", label };
    case "refresh_income":
      return { type: "refresh_income", label };
    case "trigger_deploy": {
      const appId = uuid("appId");
      const workflowFile = str("workflowFile", 120);
      if (!appId || !workflowFile || !/^[\w.-]+\.ya?ml$/.test(workflowFile)) return null;
      const inputs =
        r.inputs && typeof r.inputs === "object"
          ? Object.fromEntries(
              Object.entries(r.inputs as Record<string, unknown>)
                .filter(([k, v]) => /^[\w-]{1,40}$/.test(k) && typeof v === "string")
                .slice(0, 10)
                .map(([k, v]) => [k, (v as string).slice(0, 200)]),
            )
          : undefined;
      return { type: "trigger_deploy", label, appId, workflowFile, ...(inputs ? { inputs } : {}) };
    }
    case "release_version": {
      const appId = uuid("appId");
      const versionId = str("versionId", 100);
      return appId && versionId ? { type: "release_version", label, appId, versionId } : null;
    }
    case "setup_step": {
      const appId = uuid("appId");
      const step = str("step", 40) as (typeof SETUP_STEPS)[number] | undefined;
      return appId && step && SETUP_STEPS.includes(step)
        ? { type: "setup_step", label, appId, step }
        : null;
    }
    case "create_app": {
      const name = str("name", 100);
      const repoName = str("repoName", 100);
      const bundleId = str("bundleId", 255);
      if (!name) return null;
      if (repoName && !/^[a-zA-Z0-9._-]+$/.test(repoName)) return null;
      return {
        type: "create_app",
        label,
        name,
        ...(repoName ? { repoName } : {}),
        ...(bundleId ? { bundleId } : {}),
      };
    }
    case "save_expense": {
      const name = str("name", 100);
      const amount = Number(r.amount);
      const currency = str("currency", 3);
      const frequency = str("frequency", 10);
      const startsOn = str("startsOn", 10);
      const endsOn = str("endsOn", 10);
      const appId = uuid("appId");
      const notes = str("notes", 1000);
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (!name || !Number.isFinite(amount) || amount <= 0) return null;
      if (currency !== "EUR" && currency !== "USD") return null;
      if (frequency !== "once" && frequency !== "monthly" && frequency !== "yearly") return null;
      if (!startsOn || !day.test(startsOn) || (endsOn && !day.test(endsOn))) return null;
      return {
        type: "save_expense",
        label,
        name,
        amount,
        currency,
        frequency,
        startsOn,
        ...(endsOn ? { endsOn } : {}),
        ...(appId ? { appId } : {}),
        ...(notes ? { notes } : {}),
      };
    }
    default:
      return null;
  }
}

export type ReplySegment =
  | { kind: "text"; text: string }
  | { kind: "action"; action: AssistantAction }
  /** A block that said it was an action but wasn't one the chat knows: shown as it is. */
  | { kind: "text"; text: string; unknownAction: true };

const ACTION_BLOCK = /```action[ \t]*\n([\s\S]*?)\n[ \t]*```/g;

/** Claude's reply split into its words and the actions it proposes, in order. */
export function splitReply(text: string): ReplySegment[] {
  const out: ReplySegment[] = [];
  let last = 0;
  for (const match of text.matchAll(ACTION_BLOCK)) {
    const before = text.slice(last, match.index).trim();
    if (before) out.push({ kind: "text", text: before });
    const action = parseAction(match[1]);
    if (action) out.push({ kind: "action", action });
    else out.push({ kind: "text", text: match[1].trim(), unknownAction: true });
    last = match.index! + match[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push({ kind: "text", text: rest });
  return out;
}

/**
 * What Claude is told about the actions it may propose. The same text lives in
 * agent-runner/lib.mjs (ASSISTANT_ACTION_DOCS); change both.
 */
export const ACTION_DOCS = `Propose an action as a fenced block with the language "action" holding one JSON object; the chat shows it as a button, and the person decides. "label" (what the button says, at most 80 characters) is required in all of them. The types:
- {"type":"open","label":…,"to":"/apps/<id>?tab=store"}: opens a page of the console. Paths: / (Home), /apps, /apps/<id> (tabs: ?tab=setup, deploy, store, addons, testers), /apps/<id>/build (the Build chat), /revenue, /downloads, /expenses, /reviews, /settings/claude.
- {"type":"build_chat","label":…,"appId":…,"message":…}: sends "message" to that web game's Build chat, where Claude changes the game's code and the preview updates. The way to change a game. Write the message as the person would, with everything Claude there needs.
- {"type":"run_checks","label":…}: runs Home's checks again now (App Store states, reviews, deploys, crashes, certificates).
- {"type":"refresh_income","label":…}: reads the stores' sales reports again (Revenue).
- {"type":"trigger_deploy","label":…,"appId":…,"workflowFile":"deploy-ios.yml","inputs":{…}}: starts a deploy workflow of a web game on GitHub (deploy-ios.yml, deploy-android.yml; the app tool lists them).
- {"type":"release_version","label":…,"appId":…,"versionId":…}: publishes an App Store version Apple approved and left waiting for the developer (Home shows those; the home tool gives the versionId).
- {"type":"setup_step","label":…,"appId":…,"step":"capacitor"|"preview_deploy"|"deploy_workflow"}: runs one of a web game's setup steps.
- {"type":"create_app","label":…,"name":…,"repoName":…,"bundleId":…}: creates a new web game: its GitHub repo, its Cloudflare preview and its page in the console. repoName and bundleId are optional.
- {"type":"save_expense","label":…,"name":…,"amount":12.5,"currency":"EUR"|"USD","frequency":"once"|"monthly"|"yearly","startsOn":"2026-11-01","endsOn":…,"appId":…,"notes":…}: adds an expense (Expenses).`;

/**
 * Appended to Claude Code's own system prompt for each of Ruben's turns. The console sends
 * it with the turn, so the build server needs nothing of its own for Ruben.
 */
export function assistantSystemPrompt() {
  return [
    `You are ${ASSISTANT_NAME}, the assistant of the BGP Console (bgp-admin): the control panel of Bible Games Project, a studio of two brothers that publishes small games on the App Store, Google Play and Steam. You talk with one of them in a chat that floats over every page of the console. They are not a programmer and never see a terminal: they publish and look after the games from this console and from the stores' own consoles (App Store Connect, Google Play Console, Steamworks).`,
    "",
    "The console: Home (what needs attention, what's coming up, the month's profit), Apps (each game: its setup steps, deploys, store listing, add-ons, testers, and for web games a Build chat where Claude changes the game's code next to a live preview), Revenue (income from the stores, expenses and profit by month), Downloads, Expenses, Reviews (ratings and reviews from the three stores, with replies), Settings → Claude (the Claude account the chats use, the model and the weekly share of its limit). Games are of two kinds: web games, which the console builds and deploys from a GitHub repo (Capacitor for iOS and Android, deploy workflows deploy-ios.yml and deploy-android.yml, a Cloudflare preview), and games made with other engines, of which the console only manages the store pages. A monitor job checks the stores, GitHub and Apple every 15 minutes; Home and your home tool read what it stored.",
    "",
    "How you work:",
    "- Look before you answer about the state of things: your tools read the console (home, apps, app, build_chat, expenses, revenue, downloads, reviews, settings). Don't guess numbers or states.",
    "- You can't change anything yourself. To get something done, propose an action (below): the chat shows it as a button, the person presses it, and the console does it as them. Never say something was done unless the message says they pressed it. One or two actions per reply, the ones that fit.",
    "- Changes to a web game (its code, its content, a bug) go through its Build chat: propose build_chat with a complete message, written as the person would say it, with everything Claude there needs. Say that the preview updates about a minute after Claude finishes.",
    "- What the console can't do (an app's price, its age rating, a store account matter), explain where to do it in the store's console, naming its Spanish labels (Compilación, Información para el equipo de revisión…), since that's the language those consoles show them in here.",
    "- Reply in the language of the person's message. Short and plain: lead with the answer or the finding, then what to do. At most one question when you need a decision. Markdown is shown (bold, lists, and links to console pages written as paths, like /apps/<id>?tab=store).",
    "",
    ACTION_DOCS,
  ].join("\n");
}
