import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Sparkles, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { stopBuildTurn } from "@/lib/agent.functions";
import { getScreenshotDesign, startScreenshotDesign } from "@/lib/store-screenshots.functions";
import {
  CAPTION_MAX,
  MAX_CAPTURES,
  canvasSize,
  type ScreenshotDesign,
  type ScreenshotStore,
} from "@/lib/store-screenshots";
import { drawScreenshot, loadCapture, screenshotFile } from "@/lib/store-screenshots.render";
import { localeLabel } from "@/lib/store-listing";

export type ScreenshotSlot = { type: string; label: string; room: number };

type Capture = { file: File; image: HTMLImageElement; url: string; note: string };

const styleKey = (appId: string) => `bgp-screenshot-style:${appId}`;

/**
 * "Make screenshots with Claude", under a language's screenshots: real captures of the game
 * and the style in the person's words go to Claude, which answers with a design and the
 * captions; the browser draws the images at the slot's size, and `onAdd` hands them to the
 * usual upload (App Store) or staging (Google Play).
 */
export function ScreenshotsWithClaude({
  appId,
  store,
  locale,
  about,
  slots,
  disabled,
  onAdd,
}: {
  appId: string;
  store: ScreenshotStore;
  locale: string;
  /** The listing's description in this language, so Claude knows the game. */
  about: string;
  slots: ScreenshotSlot[];
  disabled?: boolean;
  onAdd: (slot: string, files: File[]) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5"
        disabled={disabled || slots.every((s) => s.room <= 0)}
        title="Upload captures of the game, say the style you want, and Claude designs the store screenshots."
        onClick={() => setOpen(true)}
      >
        <Sparkles className="h-3.5 w-3.5" /> Make screenshots with Claude
      </Button>
      {open && (
        <ScreenshotsDialog
          appId={appId}
          store={store}
          locale={locale}
          about={about}
          slots={slots}
          onAdd={onAdd}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ScreenshotsDialog({
  appId,
  store,
  locale,
  about,
  slots,
  onAdd,
  onClose,
}: {
  appId: string;
  store: ScreenshotStore;
  locale: string;
  about: string;
  slots: ScreenshotSlot[];
  onAdd: (slot: string, files: File[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const startFn = useServerFn(startScreenshotDesign);
  const getFn = useServerFn(getScreenshotDesign);
  const stopFn = useServerFn(stopBuildTurn);
  const input = useRef<HTMLInputElement>(null);

  const [slot, setSlot] = useState(() => (slots.find((s) => s.room > 0) ?? slots[0]).type);
  const room = slots.find((s) => s.type === slot)?.room ?? 0;
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [style, setStyle] = useState(() => {
    try {
      return localStorage.getItem(styleKey(appId)) ?? "";
    } catch {
      return "";
    }
  });
  // Once there is a design, the box asks what should change instead.
  const [changes, setChanges] = useState("");
  const [turnId, setTurnId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [design, setDesign] = useState<ScreenshotDesign | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // The captures' object URLs go when the dialog closes.
  const capturesRef = useRef(captures);
  capturesRef.current = captures;
  useEffect(() => () => capturesRef.current.forEach((c) => URL.revokeObjectURL(c.url)), []);

  const q = useQuery({
    queryKey: ["screenshot-design", turnId],
    queryFn: () => getFn({ data: { turnId: turnId! } }),
    enabled: !!turnId,
    refetchInterval: 3000,
  });
  useEffect(() => {
    const s = q.data;
    if (!s || s.id !== turnId) return;
    if (s.state === "done") {
      setTurnId(null);
      setDesign(s.design);
    } else if (s.state === "failed") {
      setTurnId(null);
      if (s.error !== "Stopped.")
        toast.error(`Claude couldn't design the screenshots: ${s.error}`, { duration: 15000 });
    }
  }, [q.data, turnId]);

  const landscape =
    !!captures[0] && captures[0].image.naturalWidth > captures[0].image.naturalHeight;
  const size = canvasSize(slot, landscape);

  // Small previews, redrawn when the design, a caption or the slot changes.
  useEffect(() => {
    if (!design || !size || !captures.length) {
      setPreviews([]);
      return;
    }
    const timer = setTimeout(() => {
      const scale = 480 / size[1];
      const next = captures.map((c, i) => {
        const full = drawScreenshot(design, design.captions[i] ?? "", c.image, size[0], size[1], i);
        const small = document.createElement("canvas");
        small.width = Math.round(size[0] * scale);
        small.height = Math.round(size[1] * scale);
        small.getContext("2d")?.drawImage(full, 0, 0, small.width, small.height);
        return small.toDataURL("image/jpeg", 0.85);
      });
      setPreviews(next);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, captures, slot, size?.[0], size?.[1]]);

  const pick = async (files: File[]) => {
    const space = Math.min(room, MAX_CAPTURES) - captures.length;
    if (files.length > space) {
      toast.warning(
        space > 0
          ? `Only ${space} more fit${space === 1 ? "s" : ""}; the rest were skipped.`
          : "No more fit in this slot.",
      );
    }
    const loaded: Capture[] = [];
    for (const file of files.slice(0, Math.max(0, space))) {
      try {
        const { image, url } = await loadCapture(file);
        loaded.push({ file, image, url, note: "" });
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    if (!loaded.length) return;
    setCaptures((c) => [...c, ...loaded]);
    // New captures need captions: keep the look, Claude writes the rest next time.
    if (design) setDesign({ ...design, captions: [...design.captions, ...loaded.map(() => "")] });
  };

  const removeCapture = (i: number) => {
    URL.revokeObjectURL(captures[i].url);
    setCaptures((c) => c.filter((_, k) => k !== i));
    if (design) setDesign({ ...design, captions: design.captions.filter((_, k) => k !== i) });
  };

  const ask = async () => {
    if (!design) {
      try {
        localStorage.setItem(styleKey(appId), style);
      } catch {
        /* private mode: it just isn't remembered */
      }
    }
    setAsking(true);
    try {
      const { turnId: id } = await startFn({
        data: {
          appId,
          store,
          locale,
          style: design ? changes : style,
          notes: captures.map((c) => c.note),
          about,
          previous: design,
        },
      });
      setTurnId(id);
      if (design) setChanges("");
    } catch (e) {
      toast.error((e as Error).message, { duration: 15000 });
    } finally {
      setAsking(false);
    }
  };

  const stop = async () => {
    const id = turnId;
    setTurnId(null);
    if (id) await stopFn({ data: { turnId: id } }).catch(() => {});
  };

  const add = async () => {
    if (!design || !size) return;
    setAdding(true);
    try {
      const files: File[] = [];
      for (const [i, c] of captures.entries()) {
        const canvas = drawScreenshot(
          design,
          design.captions[i] ?? "",
          c.image,
          size[0],
          size[1],
          i,
        );
        files.push(await screenshotFile(canvas, `screenshot-${locale}-${i + 1}.png`));
      }
      await onAdd(slot, files);
      onClose();
    } catch (e) {
      toast.error((e as Error).message, { duration: 15000 });
    } finally {
      setAdding(false);
    }
  };

  const working = asking || !!turnId;
  const s = q.data && q.data.id === turnId ? q.data : null;
  const progress = !turnId
    ? "Asking Claude…"
    : s?.state === "running"
      ? "Claude is designing the screenshots…"
      : s?.state === "waiting" && s.waitingFor
        ? `Claude will design them after ${s.waitingFor}…`
        : "Claude will design them in a moment…";

  return (
    <Dialog open onOpenChange={(o) => !o && !adding && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Make screenshots with Claude · {localeLabel(locale)}</DialogTitle>
          <DialogDescription>
            Add captures of the game and say the style you want. Claude picks the background,
            colours, letters and phone frame and writes a line for each one in {localeLabel(locale)}
            . You can change the lines, ask for changes, and add them when you like them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {slots.length > 1 && (
              <Select value={slot} onValueChange={setSlot} disabled={working || adding}>
                <SelectTrigger className="h-8 w-auto text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {slots.map((s) => (
                    <SelectItem key={s.type} value={s.type} disabled={s.room <= 0}>
                      {s.label} {s.room <= 0 ? "(full)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {size && (
              <span className="text-xs text-muted-foreground">
                {size[0]}×{size[1]} · up to {Math.min(room, MAX_CAPTURES)} here
              </span>
            )}
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void pick(files);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 ml-auto"
              disabled={working || adding || captures.length >= Math.min(room, MAX_CAPTURES)}
              onClick={() => input.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" /> Add captures of the game
            </Button>
          </div>

          {captures.length === 0 ? (
            <p className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Start with real captures of the game (from the preview, a phone or the simulator).
              Claude doesn't draw: it puts them in a frame, over a background, with a line of text.
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {captures.map((c, i) => (
                <div key={c.url} className="w-44 shrink-0 space-y-1.5">
                  <div className="relative">
                    <img
                      src={previews[i] ?? c.url}
                      alt=""
                      className="h-72 w-full rounded border border-border bg-muted object-contain"
                    />
                    <button
                      type="button"
                      title="Remove"
                      aria-label="Remove"
                      disabled={working || adding}
                      onClick={() => removeCapture(i)}
                      className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded bg-background/80 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {design ? (
                    <Input
                      value={design.captions[i] ?? ""}
                      maxLength={CAPTION_MAX}
                      placeholder="Line on this screenshot"
                      className="h-8 text-xs"
                      disabled={working || adding}
                      onChange={(e) =>
                        setDesign((d) =>
                          d
                            ? {
                                ...d,
                                captions: d.captions.map((t, k) => (k === i ? e.target.value : t)),
                              }
                            : d,
                        )
                      }
                    />
                  ) : (
                    <Input
                      value={c.note}
                      maxLength={300}
                      placeholder="What it shows (optional)"
                      className="h-8 text-xs"
                      disabled={working}
                      onChange={(e) =>
                        setCaptures((all) =>
                          all.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="screenshot-style" className="text-xs font-medium">
              {design ? "What should change?" : "The style you want"}
            </label>
            <Textarea
              id="screenshot-style"
              rows={3}
              maxLength={2000}
              value={design ? changes : style}
              disabled={working || adding}
              placeholder={
                design
                  ? "e.g. warmer colours, the text at the bottom, no phone frame"
                  : "e.g. sky blue background with clouds, big yellow text on top, fun and for kids"
              }
              onChange={(e) => (design ? setChanges : setStyle)(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              It runs on the build server like the Build chat, takes a minute or so and uses a
              little of its weekly share.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            {working ? (
              <span className="mr-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {progress}
                {turnId && (
                  <button
                    onClick={stop}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    title="Stop"
                  >
                    <Square className="h-3 w-3" /> Stop
                  </button>
                )}
              </span>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClose} disabled={adding}>
              Cancel
            </Button>
            <Button
              variant={design ? "outline" : "default"}
              size="sm"
              className="gap-1.5"
              disabled={working || adding || captures.length === 0 || (!!design && !changes.trim())}
              onClick={ask}
            >
              <Sparkles className="h-4 w-4" /> {design ? "Ask Claude for changes" : "Ask Claude"}
            </Button>
            {design && (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={working || adding || !previews.length}
                onClick={add}
              >
                {adding && <Loader2 className="h-4 w-4 animate-spin" />}
                {store === "ios"
                  ? `Upload ${captures.length} to the App Store`
                  : `Add ${captures.length} to the changes`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
