import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  Gauge,
  KeyRound,
  Loader2,
  Server,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelClaudeLogin,
  getClaudeSettings,
  pasteClaudeToken,
  saveAgentSettings,
  startClaudeLogin,
  submitClaudeLoginCode,
  unlinkClaudeAccount,
  type ClaudeLoginView,
} from "@/lib/agent.functions";
import {
  AGENT_EFFORTS,
  AGENT_MODELS,
  resetLabel,
  type RunnerView,
  type WeeklyBudget,
} from "@/lib/agent";
import { UsageSummary } from "@/components/build/UsageSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export const Route = createFileRoute("/_authenticated/settings/claude")({
  head: () => ({ meta: [{ title: "Claude — bgp console" }] }),
  component: ClaudeSettingsPage,
});

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
const ACTIVE_LOGIN = ["starting", "waiting_code", "checking"];

function ClaudeSettingsPage() {
  const getFn = useServerFn(getClaudeSettings);
  const q = useQuery({
    queryKey: ["claude-settings"],
    queryFn: () => getFn(),
    // Every couple of seconds while signing in, so each step shows up at once.
    refetchInterval: (query) =>
      query.state.data?.login && ACTIVE_LOGIN.includes(query.state.data.login.status)
        ? 2000
        : 10_000,
  });

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold tracking-tight">Claude</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The Claude account the Build chat works with, and the server where Claude runs.
        </p>
      </div>
      {q.isLoading ? (
        <div className="p-6 flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (
        <>
          <RunnerCard runner={q.data!.runner} />
          <AccountCard data={q.data!} />
          <ModelCard settings={q.data!.settings} />
          <WeeklyShareCard settings={q.data!.settings} budget={q.data!.budget} />
        </>
      )}
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bot;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-md bg-card">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <Icon className="h-4 w-4 text-primary" />
        <span className="label-mono text-sm">{title}</span>
      </div>
      <div className="p-4 space-y-3 text-sm">{children}</div>
    </div>
  );
}

function RunnerCard({ runner }: { runner: RunnerView }) {
  return (
    <Card icon={Server} title="Build server">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${runner.online ? "bg-emerald-500" : "bg-destructive"}`}
        />
        <span className="font-medium">
          {runner.online ? (runner.busy ? "Online, working" : "Online") : "Offline"}
        </span>
        {runner.host && (
          <span className="text-muted-foreground font-mono text-xs">
            {runner.host}
            {runner.version ? ` · v${runner.version}` : ""}
          </span>
        )}
      </div>
      {!runner.online && (
        <p className="text-muted-foreground">
          {runner.lastSeenAt
            ? `It last checked in ${ago(runner.lastSeenAt)}. `
            : "It has never checked in. "}
          While it's off, Claude can't work: messages sent in the Build chat wait in line and start
          when it's back. It's the bgp-agent service (agent-runner/ in the bgp-admin repo).
        </p>
      )}
    </Card>
  );
}

type SettingsData = Awaited<ReturnType<typeof getClaudeSettings>>;

function AccountCard({ data }: { data: SettingsData }) {
  const qc = useQueryClient();
  const startFn = useServerFn(startClaudeLogin);
  const unlinkFn = useServerFn(unlinkClaudeAccount);
  const refresh = () => qc.invalidateQueries({ queryKey: ["claude-settings"] });
  const start = useMutation({
    mutationFn: () => startFn(),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const unlink = useMutation({
    mutationFn: () => unlinkFn(),
    onSuccess: () => {
      toast.success("The build server will forget the account in a few seconds.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { account, login } = data;
  const signingIn = login && ACTIVE_LOGIN.includes(login.status);

  return (
    <Card icon={Bot} title="Claude account">
      {signingIn ? (
        <LoginSteps login={login} runnerOnline={data.runner.online} />
      ) : (
        <>
          {login?.status === "failed" && (
            <p className="flex gap-2 text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Linking didn't work: {login.error}</span>
            </p>
          )}
          {account && !data.unlinkPending ? (
            <>
              {account.rejectedAt ? (
                <p className="flex gap-2 text-destructive">
                  <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Claude stopped accepting this account {ago(account.rejectedAt)} (its sign-in
                    expired or was revoked). Link it again to keep using the Build chat.
                  </span>
                </p>
              ) : (
                <p className="flex gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
                  <span>
                    Linked
                    {account.linkedBy ? ` by ${account.linkedBy}` : ""}
                    {account.linkedAt ? ` ${ago(account.linkedAt)}` : ""}.{" "}
                    <span className="text-muted-foreground font-mono text-xs">
                      token …{account.last4}
                    </span>
                  </span>
                </p>
              )}
              <UsageSummary usage={data.usage} />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
                  {account.rejectedAt ? "Link it again" : "Switch account"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={unlink.isPending}
                  onClick={() => {
                    if (
                      confirm(
                        "Unlink the Claude account? The Build chat stops working until one is linked again.",
                      )
                    ) {
                      unlink.mutate();
                    }
                  }}
                >
                  Unlink
                </Button>
              </div>
            </>
          ) : data.unlinkPending ? (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Unlinking: the build server forgets
              the account when it next checks in.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                The Build chat runs Claude Code with a Claude subscription (Pro or Max). Link the
                account it should use: you sign in on claude.ai and paste back the code it shows.
                The sign-in lasts a year.
              </p>
              <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
                Link a Claude account
              </Button>
            </>
          )}
          <PasteToken />
        </>
      )}
    </Card>
  );
}

function LoginSteps({ login, runnerOnline }: { login: ClaudeLoginView; runnerOnline: boolean }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const submitFn = useServerFn(submitClaudeLoginCode);
  const cancelFn = useServerFn(cancelClaudeLogin);
  const refresh = () => qc.invalidateQueries({ queryKey: ["claude-settings"] });
  const submit = useMutation({
    mutationFn: () => submitFn({ data: { id: login.id, code } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { id: login.id } }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-3">
      {login.status === "starting" && (
        <>
          <p className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {login.mode === "token"
              ? "Handing the token to the build server…"
              : "Asking the build server for a sign-in link…"}
          </p>
          {!runnerOnline && (
            <p className="text-destructive text-xs">
              The build server is offline, so this waits until it's back (see Build server above).
            </p>
          )}
        </>
      )}
      {login.status === "waiting_code" && login.url && (
        <ol className="space-y-4 list-decimal pl-5">
          <li className="space-y-2">
            <p>Open claude.ai and sign in with the Claude account the Build chat should use.</p>
            <Button asChild size="sm" variant="outline" className="gap-2">
              <a href={login.url} target="_blank" rel="noreferrer">
                Open claude.ai <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </li>
          <li className="space-y-2">
            <p>When it shows a code, copy it and paste it here.</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit.mutate();
              }}
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste the code"
                autoComplete="off"
                className="font-mono"
              />
              <Button type="submit" size="sm" disabled={!code.trim() || submit.isPending}>
                Link
              </Button>
            </form>
          </li>
        </ol>
      )}
      {login.status === "checking" && (
        <p className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the account with Claude (up to a
          minute)…
        </p>
      )}
      <Button size="sm" variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
        Cancel
      </Button>
    </div>
  );
}

function PasteToken() {
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const pasteFn = useServerFn(pasteClaudeToken);
  const paste = useMutation({
    mutationFn: () => pasteFn({ data: { token } }),
    onSuccess: () => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["claude-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
        Or paste a token made in a terminal
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          Run <code className="font-mono">claude setup-token</code> on any computer with Claude
          Code, sign in, and paste the token it prints (it starts with sk-ant-oat).
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            paste.mutate();
          }}
        >
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="sk-ant-oat01-…"
            autoComplete="off"
            className="font-mono"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!token.trim() || paste.isPending}
            className="gap-2"
          >
            <KeyRound className="h-3.5 w-3.5" /> Use it
          </Button>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ModelCard({ settings }: { settings: SettingsData["settings"] }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveAgentSettings);
  const save = useMutation({
    mutationFn: (next: typeof settings) => saveFn({ data: next }),
    onSuccess: () => {
      toast.success("Saved. It applies from the next message.");
      qc.invalidateQueries({ queryKey: ["claude-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card icon={Bot} title="Model">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Model</span>
          <Select
            value={settings.model}
            onValueChange={(model) =>
              save.mutate({ ...settings, model: model as typeof settings.model })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} <span className="text-muted-foreground">· {m.note}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Effort</span>
          <Select
            value={settings.effort}
            onValueChange={(effort) =>
              save.mutate({ ...settings, effort: effort as typeof settings.effort })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGENT_EFFORTS.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Higher effort thinks longer before changing the game: slower, and it uses more of the
        account's limit.
      </p>
    </Card>
  );
}

/**
 * How much of the account's weekly limit the Build chat may use. The account is shared
 * with Claude Code elsewhere, so this keeps the chat from using it all up.
 */
function WeeklyShareCard({
  settings,
  budget,
}: {
  settings: SettingsData["settings"];
  budget: WeeklyBudget;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveAgentSettings);
  const [value, setValue] = useState(String(settings.weeklyBudgetPercent));
  useEffect(() => setValue(String(settings.weeklyBudgetPercent)), [settings.weeklyBudgetPercent]);
  const percent = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(percent) && percent >= 0 && percent <= 100;
  const save = useMutation({
    mutationFn: () => saveFn({ data: { ...settings, weeklyBudgetPercent: percent } }),
    onSuccess: () => {
      toast.success(
        percent > 0 ? `Saved: the Build chat may use ${percent}% a week.` : "Saved: no limit.",
      );
      qc.invalidateQueries({ queryKey: ["claude-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card icon={Gauge} title="Weekly share">
      <p className="text-muted-foreground">
        How much of the Claude account's weekly limit the Build chat may use, so it can't use up
        what Claude Code needs elsewhere with the same account. 0 means no limit.
      </p>
      <form
        className="flex items-center gap-2 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24"
          aria-label="Share of the weekly limit, in percent"
        />
        <span className="text-muted-foreground">% of the weekly limit</span>
        <Button
          type="submit"
          size="sm"
          disabled={!valid || save.isPending || percent === settings.weeklyBudgetPercent}
        >
          Save
        </Button>
      </form>
      <WeeklyShareStatus budget={budget} />
      <p className="text-xs text-muted-foreground">
        Claude reports the account's usage after each message, and what the chat used this week is
        the sum of those, so it's approximate by a percent or two. Once the share is used, messages
        wait until the limit resets; a message under way is stopped where it is, and what it had
        saved is kept.
      </p>
    </Card>
  );
}

function WeeklyShareStatus({ budget }: { budget: WeeklyBudget }) {
  if (budget.percent <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No limit: the chat may use the whole weekly limit.
      </p>
    );
  }
  const used = Math.min(100, (budget.spent / budget.percent) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
        <span>Used this week</span>
        <span className="text-right">
          {budget.spent}% of {budget.percent}%
          {budget.resetsAt
            ? ` · resets ${resetLabel(budget.resetsAt)} (${ago(budget.resetsAt)})`
            : " · Claude hasn't reported the account's usage yet"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${budget.exhausted ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${used}%` }}
        />
      </div>
      {budget.exhausted && (
        <p className="text-xs text-destructive flex gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-px" />
          Used up: messages in the Build chat wait until it resets.
        </p>
      )}
    </div>
  );
}
