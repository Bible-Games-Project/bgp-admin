import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import type { AssistantAction } from "@/lib/assistant";
import { sendBuildMessage } from "@/lib/agent.functions";
import { createAppWithRepo } from "@/lib/apps.functions";
import {
  createDeployWorkflow,
  createPreviewDeployWorkflow,
  setupCapacitor,
} from "@/lib/capacitor.functions";
import { triggerDeploy } from "@/lib/deploy.functions";
import { saveExpense } from "@/lib/expenses.functions";
import { releaseAppStoreVersion, runChecks } from "@/lib/home.functions";
import { refreshIncome } from "@/lib/income.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The actions Ruben proposes, as buttons. Pressing one does the thing with the console's
// own server functions, as the person: Ruben itself never changes anything. The shapes are
// in src/lib/assistant.ts (parseAction); what Claude is told about them is ACTION_DOCS.

/** Actions worth a second look before they run. */
const CONFIRM: Partial<Record<AssistantAction["type"], (a: AssistantAction) => string>> = {
  trigger_deploy: (a) =>
    a.type === "trigger_deploy" ? `Start ${a.workflowFile} for this app on GitHub?` : "",
  release_version: () => "Publish this App Store version now? Players get it within hours.",
  create_app: (a) =>
    a.type === "create_app"
      ? `Create the app "${a.name}", with its GitHub repo and its Cloudflare preview?`
      : "",
  build_chat: (a) =>
    a.type === "build_chat" ? `Send this to the game's Build chat?\n\n${a.message}` : "",
};

/** Runs an action; resolves with what came of it, in a few words. */
export function useRunAction() {
  const navigate = useNavigate();
  const buildFn = useServerFn(sendBuildMessage);
  const checksFn = useServerFn(runChecks);
  const incomeFn = useServerFn(refreshIncome);
  const deployFn = useServerFn(triggerDeploy);
  const releaseFn = useServerFn(releaseAppStoreVersion);
  const capacitorFn = useServerFn(setupCapacitor);
  const previewFn = useServerFn(createPreviewDeployWorkflow);
  const workflowFn = useServerFn(createDeployWorkflow);
  const createAppFn = useServerFn(createAppWithRepo);
  const expenseFn = useServerFn(saveExpense);

  return async (action: AssistantAction): Promise<string> => {
    switch (action.type) {
      case "open":
        await navigate({ href: action.to });
        return "opened";
      case "build_chat":
        await buildFn({ data: { appId: action.appId, prompt: action.message } });
        await navigate({ to: "/apps/$id/build", params: { id: action.appId } });
        return "sent to the Build chat";
      case "run_checks":
        await checksFn({ data: { since: new Date().toISOString() } });
        return "the checks ran";
      case "refresh_income":
        await incomeFn();
        return "the sales reports were read again";
      case "trigger_deploy":
        await deployFn({
          data: { appId: action.appId, workflowFile: action.workflowFile, inputs: action.inputs },
        });
        return `${action.workflowFile} started on GitHub`;
      case "release_version":
        await releaseFn({ data: { appId: action.appId, versionId: action.versionId } });
        return "the version was released";
      case "setup_step": {
        const fn =
          action.step === "capacitor"
            ? capacitorFn
            : action.step === "preview_deploy"
              ? previewFn
              : workflowFn;
        await fn({ data: { appId: action.appId } });
        return `the ${action.step.replace("_", " ")} step ran`;
      }
      case "create_app": {
        const { app } = await createAppFn({
          data: {
            name: action.name,
            repoName: action.repoName,
            bundle_id: action.bundleId ?? null,
            default_ref: "main",
            is_active: true,
          },
        });
        await navigate({ to: "/apps/$id", params: { id: app.id } });
        return `the app ${action.name} was created`;
      }
      case "save_expense":
        await expenseFn({
          data: {
            id: null,
            expense: {
              name: action.name,
              amount: action.amount,
              currency: action.currency,
              frequency: action.frequency,
              starts_on: action.startsOn,
              ends_on: action.endsOn ?? null,
              app_id: action.appId ?? null,
              notes: action.notes ?? null,
            },
            priceFrom: null,
          },
        });
        return "the expense was saved";
    }
  };
}

export function ActionButton({
  action,
  onRan,
}: {
  action: AssistantAction;
  /** What came of it, for Ruben's next message. */
  onRan: (label: string, outcome: string) => void;
}) {
  const run = useRunAction();
  const [state, setState] = useState<{
    status: "idle" | "running" | "done" | "failed";
    note?: string;
  }>({ status: "idle" });
  const press = async () => {
    const ask = CONFIRM[action.type]?.(action);
    if (ask && !confirm(ask)) return;
    setState({ status: "running" });
    try {
      const outcome = await run(action);
      setState({ status: "done", note: outcome });
      onRan(action.label, outcome);
    } catch (error) {
      const note = (error as Error).message;
      setState({ status: "failed", note });
      onRan(action.label, `it failed: ${note}`);
    }
  };
  return (
    <div className="space-y-1">
      <Button
        type="button"
        size="sm"
        variant={state.status === "done" ? "outline" : "default"}
        className={cn("gap-1.5 max-w-full whitespace-normal h-auto py-1.5 text-left")}
        disabled={state.status === "running"}
        onClick={press}
      >
        {state.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : state.status === "done" ? (
          <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ) : (
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        )}
        {action.label}
      </Button>
      {state.status === "done" && state.note && (
        <p className="text-[11px] text-muted-foreground">Done: {state.note}.</p>
      )}
      {state.status === "failed" && (
        <p className="text-[11px] text-destructive flex gap-1">
          <TriangleAlert className="h-3 w-3 shrink-0 mt-0.5" />
          {state.note}
        </p>
      )}
    </div>
  );
}
