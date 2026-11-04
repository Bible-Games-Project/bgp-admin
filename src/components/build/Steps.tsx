import { useState } from "react";
import { ChevronRight, CircleCheck, CircleDashed, Loader2 } from "lucide-react";
import type { AgentEvent } from "@/lib/agent";
import { cn } from "@/lib/utils";

// What Claude did during a turn, as the Build chat and Ruben show it: the runs of steps
// between its words, folded into one line each that opens to the list.

type Segment = { kind: "text"; event: AgentEvent } | { kind: "steps"; events: AgentEvent[] };

/** Claude's words, with each run of steps between them folded into one group. */
export function segments(events: AgentEvent[]): Segment[] {
  const out: Segment[] = [];
  for (const event of events) {
    const last = out[out.length - 1];
    if (event.kind === "step") {
      if (last?.kind === "steps") last.events.push(event);
      else out.push({ kind: "steps", events: [event] });
    } else out.push({ kind: "text", event });
  }
  return out;
}

const label = (event: AgentEvent) => ("label" in event.body ? event.body.label : "");

export function StepsGroup({ events, live }: { events: AgentEvent[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const last = events[events.length - 1];
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 hover:text-foreground max-w-full"
      >
        <ChevronRight
          className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        {live ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
        <span className="truncate">
          {events.length === 1 ? "1 step" : `${events.length} steps`} · {label(last)}
        </span>
      </button>
      {open && (
        <ul className="mt-1.5 ml-4 space-y-1 border-l border-border pl-3">
          {events.map((e) => (
            <li key={e.id} className="break-words">
              {label(e)}
              {"todos" in e.body && e.body.todos?.length ? (
                <ul className="mt-1 space-y-0.5">
                  {e.body.todos.map((t, i) => (
                    <li key={i} className="flex gap-1.5">
                      {t.status === "completed" ? (
                        <CircleCheck className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" />
                      ) : (
                        <CircleDashed className="h-3 w-3 mt-0.5 shrink-0" />
                      )}
                      <span
                        className={cn(
                          t.status === "completed" && "line-through",
                          t.status === "in_progress" && "text-foreground font-medium",
                        )}
                      >
                        {t.content}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
