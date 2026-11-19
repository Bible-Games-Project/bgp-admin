import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Languages, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { stopBuildTurn } from "@/lib/agent.functions";
import {
  getStoreTranslations,
  startStoreTranslation,
  type StoreTranslationState,
} from "@/lib/store-translate.functions";
import { localeLabel } from "@/lib/store-listing";
import type { TranslateStore } from "@/lib/store-translate";

type Job = { turnId: string | null; from: string };

/**
 * The Store tab's translations under way, by language. They live in the panel, so
 * switching language (or store) while Claude works never loses the result: it lands in
 * that language's unsaved edits through `onDone`.
 */
export function useStoreTranslations({
  appId,
  store,
  onDone,
}: {
  appId: string;
  store: TranslateStore;
  onDone: (to: string, fields: Record<string, string>) => void;
}) {
  const startFn = useServerFn(startStoreTranslation);
  const getFn = useServerFn(getStoreTranslations);
  const stopFn = useServerFn(stopBuildTurn);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const turnIds = Object.values(jobs)
    .map((j) => j.turnId)
    .filter((id): id is string => !!id);
  const q = useQuery({
    queryKey: ["store-translations", appId, store, turnIds],
    queryFn: () => getFn({ data: { turnIds } }),
    enabled: turnIds.length > 0,
    refetchInterval: 3000,
  });

  const drop = (to: string) =>
    setJobs((j) => {
      const { [to]: _, ...rest } = j;
      return rest;
    });

  // Finished translations go into the fields once; failed ones say why.
  useEffect(() => {
    for (const s of q.data ?? []) {
      const to = Object.keys(jobs).find((code) => jobs[code].turnId === s.id);
      if (!to) continue;
      if (s.state === "done") {
        drop(to);
        onDoneRef.current(to, s.fields);
        toast.success(
          s.overLimit.length
            ? `${localeLabel(to)} is translated. Some texts are a bit too long: shorten the ones in red, then save.`
            : `${localeLabel(to)} is translated. Check it, then save.`,
          { duration: 10000 },
        );
      } else if (s.state === "failed") {
        drop(to);
        if (s.error !== "Stopped.")
          toast.error(`Claude couldn't translate ${localeLabel(to)}: ${s.error}`, {
            duration: 15000,
          });
      }
    }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (from: string, to: string, fields: Record<string, string>) => {
    if (jobs[to]) return;
    setJobs((j) => ({ ...j, [to]: { turnId: null, from } }));
    try {
      const { turnId } = await startFn({ data: { appId, store, from, to, fields } });
      setJobs((j) => ({ ...j, [to]: { turnId, from } }));
    } catch (e) {
      drop(to);
      toast.error((e as Error).message, { duration: 15000 });
    }
  };

  const stop = async (to: string) => {
    const turnId = jobs[to]?.turnId;
    drop(to);
    if (turnId) await stopFn({ data: { turnId } }).catch(() => {});
  };

  const stateOf = (to: string): StoreTranslationState | "starting" | null => {
    const job = jobs[to];
    if (!job) return null;
    return (job.turnId && q.data?.find((s) => s.id === job.turnId)) || "starting";
  };

  return { start, stop, stateOf, busy: (to: string) => !!jobs[to] };
}

/** The button, or how the translation is going, for the language on screen. */
export function TranslateWithClaude({
  from,
  to,
  disabledReason,
  translations,
  onStart,
}: {
  from: string;
  to: string;
  /** Why it can't translate now (shown as the button's tooltip), or null. */
  disabledReason: string | null;
  translations: ReturnType<typeof useStoreTranslations>;
  onStart: () => void;
}) {
  const state = translations.stateOf(to);
  if (!state) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onStart}
        disabled={!!disabledReason}
        title={
          disabledReason ??
          `Claude translates the texts from ${localeLabel(from)}, except the app's name. You check them and save.`
        }
      >
        <Languages className="h-4 w-4" /> Translate with Claude
      </Button>
    );
  }
  const label =
    state === "starting"
      ? "Asking Claude…"
      : state.state === "waiting"
        ? state.waitingFor
          ? `Claude will translate after ${state.waitingFor}…`
          : "Claude will translate in a moment…"
        : `Claude is translating from ${localeLabel(from)}…`;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
      <button
        onClick={() => translations.stop(to)}
        className="inline-flex items-center gap-1 hover:text-foreground"
        title="Stop the translation"
      >
        <Square className="h-3 w-3" /> Stop
      </button>
    </span>
  );
}
