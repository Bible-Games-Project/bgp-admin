import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, MessageSquarePlus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getBuildAttachmentUrl,
  getBuildChat,
  getPreviewDeploy,
  newBuildChat,
  sendBuildMessage,
  stopBuildTurn,
  uploadBuildAttachment,
} from "@/lib/agent.functions";
import { checkPreviewDeployWorkflow } from "@/lib/capacitor.functions";
import {
  AGENT_MODELS,
  fixPreviewPrompt,
  isActiveTurn,
  previewSrc,
  type BuildAttachment,
} from "@/lib/agent";
import { BuildChat } from "@/components/build/BuildChat";
import { BuildPreview, type PreviewDeploy } from "@/components/build/BuildPreview";
import { SplitHandle, useChatWidth } from "@/components/build/Split";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The Build chat: Claude on the left, the game's Cloudflare preview on the right (tabs on
// a phone). Claude runs on the build server (agent-runner/); this page only talks to the
// console. See src/lib/agent.ts.
export const Route = createFileRoute("/_authenticated/apps/$id_/build")({
  head: () => ({ meta: [{ title: "Build — bgp console" }] }),
  component: BuildPage,
});

/** A preview build that hasn't started this long after the push isn't coming. */
const STALLED_AFTER_MS = 10 * 60_000;

/**
 * Realtime tells the page as soon as Claude does something, so the chat moves as it works.
 * The page also polls, so it keeps working without Realtime.
 */
function useLiveUpdates(appId: string, onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        latest.current();
      }, 600);
    };
    const channel = supabase
      .channel(`build-${appId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_turns", filter: `app_id=eq.${appId}` },
        changed,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_events", filter: `app_id=eq.${appId}` },
        changed,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [appId]);
}

function BuildPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getBuildChat);
  const checkPreviewFn = useServerFn(checkPreviewDeployWorkflow);
  const deployFn = useServerFn(getPreviewDeploy);
  const sendFn = useServerFn(sendBuildMessage);
  const stopFn = useServerFn(stopBuildTurn);
  const newChatFn = useServerFn(newBuildChat);
  const uploadFn = useServerFn(uploadBuildAttachment);
  const attachmentUrlFn = useServerFn(getBuildAttachmentUrl);
  const [tab, setTab] = useState<"chat" | "preview">("chat");
  const [draft, setDraft] = useState("");
  const [reloads, setReloads] = useState(0);
  // On a wide screen the chat's width is whatever the divider was dragged to.
  const [chatWidth, setChatWidth] = useChatWidth();
  const [resizing, setResizing] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const chatKey = ["build-chat", id];
  const q = useQuery({
    queryKey: chatKey,
    queryFn: () => getFn({ data: { appId: id } }),
    refetchInterval: (query) =>
      query.state.data?.turns.some((t) => isActiveTurn(t.status)) ? 3000 : 10_000,
  });
  useLiveUpdates(id, () => qc.invalidateQueries({ queryKey: chatKey }));

  // Shares its cache with the app page and the Setup tab.
  const previewQ = useQuery({
    queryKey: ["preview-deploy-workflow", id],
    queryFn: () => checkPreviewFn({ data: { appId: id } }),
    enabled: Boolean(q.data && !q.data.blocked),
  });
  const previewUrl = previewQ.data?.previewUrl ?? null;

  // The preview of the last change Claude pushed: followed until it's live, then reloaded.
  const turns = q.data?.turns ?? [];
  const pushed = [...turns].reverse().find((t) => t.pushedSha);
  const sha = pushed?.pushedSha ?? null;
  const deployQ = useQuery({
    queryKey: ["preview-deploy", id, sha],
    queryFn: () => deployFn({ data: { appId: id, sha: sha! } }),
    enabled: Boolean(sha && previewUrl),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "live" || state === "failed") return false;
      if (pushed?.finishedAt && Date.now() - Date.parse(pushed.finishedAt) > STALLED_AFTER_MS)
        return false;
      return 4000;
    },
  });
  const stalled =
    deployQ.data?.state === "waiting" &&
    pushed?.finishedAt &&
    Date.now() - Date.parse(pushed.finishedAt) > STALLED_AFTER_MS;
  const deploy: PreviewDeploy = sha
    ? stalled
      ? { state: "stalled" }
      : (deployQ.data ?? { state: "waiting" })
    : null;

  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    const state = deployQ.data?.state;
    if (state === "live" && seen.current && seen.current !== "live") {
      setReloads((n) => n + 1);
      toast.success("The preview has Claude's latest change.");
    }
    seen.current = state;
  }, [deployQ.data?.state]);

  const send = useMutation({
    mutationFn: ({ prompt, attachmentIds = [] }: { prompt: string; attachmentIds?: string[] }) =>
      sendFn({ data: { appId: id, prompt, attachmentIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKey }),
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });
  const upload = (file: File, thumbnail: string | null) => {
    const form = new FormData();
    form.set("appId", id);
    form.set("file", file);
    if (thumbnail) form.set("thumbnail", thumbnail);
    return uploadFn({ data: form });
  };
  // The tab opens at once, from the click, and gets the link when it arrives: a tab opened
  // after waiting is what browsers block as a pop-up.
  const openAttachment = async (attachment: BuildAttachment) => {
    const tab = window.open("", "_blank");
    try {
      const { url } = await attachmentUrlFn({ data: { id: attachment.id } });
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast.error((e as Error).message);
    }
  };
  const stop = useMutation({
    mutationFn: (turnId: string) => stopFn({ data: { turnId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKey }),
    onError: (e: Error) => toast.error(e.message),
  });
  const newChat = useMutation({
    mutationFn: () => newChatFn({ data: { appId: id } }),
    onSuccess: () => {
      toast.success("New chat. Claude starts fresh; the game keeps every change.");
      qc.invalidateQueries({ queryKey: chatKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.error)
    return <div className="p-8 text-sm text-destructive">{(q.error as Error).message}</div>;
  const data = q.data!;
  const active = data.turns.find((t) => isActiveTurn(t.status));
  const model =
    AGENT_MODELS.find((m) => m.id === data.settings.model)?.label ?? data.settings.model;
  const canAsk = Boolean(data.account && !data.account.rejectedAt && !active && !send.isPending);

  if (data.blocked) {
    return (
      <div className="p-6 md:p-8 max-w-xl mx-auto space-y-4">
        <Link
          to="/apps/$id"
          params={{ id }}
          className="text-xs text-muted-foreground hover:text-foreground font-mono inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> {data.app.name}
        </Link>
        <p className="text-sm">{data.blocked}</p>
      </div>
    );
  }

  return (
    // The page fills the window below the console's header; only the chat scrolls.
    <div
      data-no-pull-refresh
      className="flex flex-col h-[calc(100dvh-3rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Link
          to="/apps/$id"
          params={{ id }}
          className="text-xs text-muted-foreground hover:text-foreground font-mono inline-flex items-center gap-1 shrink-0"
          title="Back to the app"
        >
          <ArrowLeft className="h-3 w-3" />
        </Link>
        {data.app.icon && (
          <img src={data.app.icon} alt="" className="h-6 w-6 rounded-md border border-border" />
        )}
        <h1 className="font-display font-semibold text-sm truncate">{data.app.name}</h1>
        <span className="label-mono hidden sm:inline">build</span>
        <div className="flex-1" />
        <div className="flex md:hidden rounded-md border border-border p-0.5 text-xs">
          {(["chat", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn("px-2.5 py-1 rounded capitalize", tab === t && "bg-muted font-medium")}
            >
              {t}
            </button>
          ))}
        </div>
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs text-muted-foreground hidden sm:inline-flex"
        >
          <Link to="/settings/claude" title="Model and account">
            <Settings2 className="h-3.5 w-3.5" /> {model} · {data.settings.effort}
          </Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs"
          disabled={!data.turns.length || Boolean(active) || newChat.isPending}
          title="Start a new conversation"
          onClick={() => {
            if (
              confirm(
                "Start a new chat? Claude forgets this conversation; the game keeps every change.",
              )
            ) {
              newChat.mutate();
            }
          }}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />{" "}
          <span className="hidden sm:inline">New chat</span>
        </Button>
      </div>

      <div
        ref={splitRef}
        className="flex-1 min-h-0 flex"
        style={{ "--chat-width": `${chatWidth}px` } as React.CSSProperties}
      >
        <section
          className={cn(
            // The dragged width, kept to what leaves the preview room on this window.
            "min-h-0 w-full md:w-[max(320px,min(var(--chat-width),calc(100%_-_280px)))] md:shrink-0",
            tab === "chat" ? "flex flex-col" : "hidden md:flex md:flex-col",
          )}
        >
          <BuildChat
            appName={data.app.name}
            appIcon={data.app.icon}
            repo={data.app.repo}
            turns={data.turns}
            waitingFor={data.waitingFor}
            runner={data.runner}
            account={data.account}
            budget={data.budget}
            sending={send.isPending}
            onSend={(prompt, attachmentIds) => send.mutateAsync({ prompt, attachmentIds })}
            onStop={(turnId) => stop.mutate(turnId)}
            onUpload={upload}
            onOpenAttachment={openAttachment}
            draft={draft}
            setDraft={setDraft}
          />
        </section>
        <SplitHandle
          width={chatWidth}
          containerRef={splitRef}
          onChange={setChatWidth}
          onDragging={setResizing}
        />
        <section
          className={cn(
            "min-h-0 min-w-0 flex-1",
            tab === "preview" ? "flex flex-col" : "hidden md:flex md:flex-col",
            // While the divider is dragged, the preview's iframe must not take the pointer.
            resizing && "pointer-events-none select-none",
          )}
        >
          <BuildPreview
            appId={id}
            previewUrl={previewUrl}
            checking={previewQ.isLoading}
            src={
              previewUrl
                ? previewSrc(previewUrl, `${sha?.slice(0, 7) ?? "start"}-${reloads}`)
                : null
            }
            deploy={deploy}
            onReload={() => setReloads((n) => n + 1)}
            canAsk={canAsk}
            onAskFix={() => {
              const error =
                deployQ.data && "error" in deployQ.data ? (deployQ.data.error ?? "") : "";
              setTab("chat");
              send.mutate({ prompt: fixPreviewPrompt(error) });
            }}
          />
        </section>
      </div>
    </div>
  );
}
