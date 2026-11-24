import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Languages, Loader2, Sparkles, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  changePlayImage,
  commitPlayImageEdit,
  deleteAppStoreScreenshot,
  discardPlayImageEdit,
  getAppStoreScreenshots,
  getPlayImages,
  startPlayImageEdit,
  uploadAppStoreScreenshot,
} from "@/lib/store-listing.functions";
import {
  ASC_MAX_SCREENSHOTS,
  ASC_UPLOAD_SLOTS,
  PLAY_IMAGE_RULES,
  PLAY_IMAGE_TYPES,
  ascDisplayTypeLabel,
  localeLabel,
  type StoreImage,
} from "@/lib/store-listing";
import { getScreenshotDesign, startScreenshotDesignAll } from "@/lib/store-screenshots.functions";
import {
  CAPTION_MAX,
  MAX_CAPTURES,
  canvasSize,
  designFor,
  screenshotRoom,
  type AllLanguagesDesign,
  type ScreenshotStore,
} from "@/lib/store-screenshots";
import { drawScreenshot, loadCapture, screenshotFile } from "@/lib/store-screenshots.render";
import { prepareStoreImage } from "@/lib/store-image-file";

type Capture = { file: File; image: HTMLImageElement; url: string; note: string };
type Slot = { type: string; label: string; max: number; hint?: string };

// The same key as the one-language dialog, so the style is remembered across both.
const styleKey = (appId: string) => `bgp-screenshot-style:${appId}`;

const SLOTS: Record<ScreenshotStore, Slot[]> = {
  ios: ASC_UPLOAD_SLOTS.map((s) => ({
    type: s.type,
    label: ascDisplayTypeLabel(s.type),
    max: ASC_MAX_SCREENSHOTS,
    hint:
      s.type === "APP_IPAD_PRO_3GEN_129"
        ? "only if the game runs on iPad"
        : s.type === "APP_IPHONE_65"
          ? 'optional: Apple shrinks the 6.9" ones'
          : undefined,
  })),
  play: PLAY_IMAGE_TYPES.filter(([type]) => type.endsWith("Screenshots")).map(([type, label]) => ({
    type,
    label,
    max: PLAY_IMAGE_RULES[type].max,
  })),
};

/** The slots that start ticked: the main phone one, and the others the listing already uses. */
function defaultSlots(store: ScreenshotStore, used: string[]): string[] {
  const main = store === "ios" ? "APP_IPHONE_67" : "phoneScreenshots";
  return SLOTS[store].map((s) => s.type).filter((t) => t === main || used.includes(t));
}

/**
 * «Make screenshots for every language»: the same captures and style as the one-language
 * dialog, but Claude writes the captions in every language at once, and the console draws
 * every language × device and sends them all to the store (App Store Connect uploads one
 * by one; Google Play in one change).
 */
export function ScreenshotsForAllLanguages({
  appId,
  store,
  locales,
  about,
  disabled,
}: {
  appId: string;
  store: ScreenshotStore;
  /** The listing's languages, the main one first. */
  locales: string[];
  /** The main language's description, so Claude knows the game. */
  about: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5"
        disabled={disabled || locales.length === 0}
        title="Claude designs the screenshots once and writes their lines in every language; the console makes them for every device and uploads them."
        onClick={() => setOpen(true)}
      >
        <Languages className="h-3.5 w-3.5" /> Every language and device
      </Button>
      {open && (
        <AllLanguagesDialog
          appId={appId}
          store={store}
          locales={locales}
          about={about}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AllLanguagesDialog({
  appId,
  store,
  locales,
  about,
  onClose,
}: {
  appId: string;
  store: ScreenshotStore;
  locales: string[];
  about: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const startFn = useServerFn(startScreenshotDesignAll);
  const getFn = useServerFn(getScreenshotDesign);
  const stopFn = useServerFn(stopBuildTurn);
  const ascListFn = useServerFn(getAppStoreScreenshots);
  const ascUploadFn = useServerFn(uploadAppStoreScreenshot);
  const ascDeleteFn = useServerFn(deleteAppStoreScreenshot);
  const playListFn = useServerFn(getPlayImages);
  const playStartFn = useServerFn(startPlayImageEdit);
  const playChangeFn = useServerFn(changePlayImage);
  const playCommitFn = useServerFn(commitPlayImageEdit);
  const playDiscardFn = useServerFn(discardPlayImageEdit);
  const input = useRef<HTMLInputElement>(null);
  const slots = SLOTS[store];
  const main = locales[0];

  const [captures, setCaptures] = useState<Capture[]>([]);
  const [style, setStyle] = useState(() => {
    try {
      return localStorage.getItem(styleKey(appId)) ?? "";
    } catch {
      return "";
    }
  });
  const [changes, setChanges] = useState("");
  const [chosenLocales, setChosenLocales] = useState<string[]>(locales);
  const [chosenSlots, setChosenSlots] = useState<string[] | null>(null);
  const [replace, setReplace] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [design, setDesign] = useState<AllLanguagesDesign | null>(null);
  const [shownLocale, setShownLocale] = useState(main);
  const [shownSlot, setShownSlot] = useState(slots[0].type);
  const [previews, setPreviews] = useState<string[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const stopRef = useRef(false);

  const capturesRef = useRef(captures);
  capturesRef.current = captures;
  useEffect(() => () => capturesRef.current.forEach((c) => URL.revokeObjectURL(c.url)), []);

  // Which devices the main language already has, to tick the same ones.
  const used = useQuery({
    queryKey: ["store-images", store, appId, "all-languages-used", main],
    queryFn: async () => {
      const r =
        store === "ios"
          ? await ascListFn({ data: { appId, view: "next", locale: main } })
          : await playListFn({ data: { appId, language: main } });
      return r.groups.filter((g) => g.images.length).map((g) => g.key);
    },
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (chosenSlots === null && (used.data || used.error))
      setChosenSlots(defaultSlots(store, used.data ?? []));
  }, [used.data, used.error, chosenSlots, store]);
  const slotsNow = chosenSlots ?? defaultSlots(store, []);

  const q = useQuery({
    queryKey: ["screenshot-design", turnId],
    queryFn: () => getFn({ data: { turnId: turnId! } }),
    enabled: !!turnId,
    refetchInterval: 3000,
  });
  useEffect(() => {
    const s = q.data;
    if (!s || s.id !== turnId) return;
    if (s.state === "done-all") {
      setTurnId(null);
      setDesign(s.design);
      if (s.missing.length)
        toast.warning(
          `Claude left some lines empty in ${s.missing.map(localeLabel).join(", ")}. Write them, or ask for changes.`,
          { duration: 15000 },
        );
    } else if (s.state === "failed") {
      setTurnId(null);
      if (s.error !== "Stopped.")
        toast.error(`Claude couldn't design the screenshots: ${s.error}`, { duration: 15000 });
    }
  }, [q.data, turnId]);

  const landscape =
    !!captures[0] && captures[0].image.naturalWidth > captures[0].image.naturalHeight;
  const maxCaptures = Math.min(MAX_CAPTURES, Math.max(...slots.map((s) => s.max)));

  // Small previews of the language and device shown.
  useEffect(() => {
    const size = canvasSize(shownSlot, landscape);
    if (!design || !size || !captures.length) {
      setPreviews([]);
      return;
    }
    const timer = setTimeout(() => {
      const d = designFor(design, shownLocale);
      const scale = 480 / size[1];
      setPreviews(
        captures.map((c, i) => {
          const full = drawScreenshot(d, d.captions[i] ?? "", c.image, size[0], size[1], i);
          const small = document.createElement("canvas");
          small.width = Math.round(size[0] * scale);
          small.height = Math.round(size[1] * scale);
          small.getContext("2d")?.drawImage(full, 0, 0, small.width, small.height);
          return small.toDataURL("image/jpeg", 0.85);
        }),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [design, captures, shownLocale, shownSlot, landscape]);

  const pick = async (files: File[]) => {
    const space = maxCaptures - captures.length;
    if (files.length > space)
      toast.warning(
        space > 0
          ? `Only ${space} more fit${space === 1 ? "s" : ""}; the rest were skipped.`
          : "No more fit.",
      );
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
    if (design)
      setDesign({
        ...design,
        captions: Object.fromEntries(
          Object.entries(design.captions).map(([l, list]) => [
            l,
            [...list, ...loaded.map(() => "")],
          ]),
        ),
      });
  };

  const removeCapture = (i: number) => {
    URL.revokeObjectURL(captures[i].url);
    setCaptures((c) => c.filter((_, k) => k !== i));
    if (design)
      setDesign({
        ...design,
        captions: Object.fromEntries(
          Object.entries(design.captions).map(([l, list]) => [l, list.filter((_, k) => k !== i)]),
        ),
      });
  };

  // Languages Claude hasn't written yet (ticked after the design came back).
  const unwritten = design ? chosenLocales.filter((l) => !design.captions[l]) : [];
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
      const ordered = locales.filter((l) => chosenLocales.includes(l));
      const { turnId: id } = await startFn({
        data: {
          appId,
          store,
          locales: ordered,
          style: design ? changes || "Write the lines for the languages that have none." : style,
          notes: captures.map((c) => c.note),
          about,
          previous: design
            ? {
                ...design,
                captions: Object.fromEntries(
                  ordered.map((l) => [l, design.captions[l] ?? captures.map(() => "")]),
                ),
              }
            : null,
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

  const toSend = locales.filter((l) => chosenLocales.includes(l));
  const emptyLines = design
    ? toSend.filter((l) =>
        (design.captions[l] ?? []).some((c, i) => i < captures.length && !c.trim()),
      )
    : [];
  const sendable =
    !!design &&
    captures.length > 0 &&
    toSend.length > 0 &&
    slotsNow.length > 0 &&
    unwritten.length === 0 &&
    emptyLines.length === 0;

  /** The screenshot for one language, device and capture, as a file. */
  const render = async (locale: string, slot: string, i: number) => {
    const size = canvasSize(slot, landscape)!;
    const d = designFor(design!, locale);
    const canvas = drawScreenshot(d, d.captions[i] ?? "", captures[i].image, size[0], size[1], i);
    return screenshotFile(canvas, `screenshot-${locale}-${slot}-${i + 1}.png`);
  };

  const sendIos = async () => {
    let done = 0;
    const skipped: string[] = [];
    for (const locale of toSend) {
      if (stopRef.current) break;
      setSending(`Looking at ${localeLabel(locale)}…`);
      const { groups } = await ascListFn({ data: { appId, view: "next", locale } });
      for (const slot of slotsNow) {
        if (stopRef.current) break;
        const existing: StoreImage[] = groups.find((g) => g.key === slot)?.images ?? [];
        if (replace) {
          for (const img of existing) {
            if (stopRef.current) break;
            setSending(`Removing the old ${localeLabel(locale)} ones…`);
            await ascDeleteFn({ data: { appId, locale, screenshotId: img.id } });
          }
        }
        const n = screenshotRoom(ASC_MAX_SCREENSHOTS, existing.length, captures.length, replace);
        if (n < captures.length)
          skipped.push(`${localeLabel(locale)} · ${ascDisplayTypeLabel(slot)}`);
        for (let i = 0; i < n && !stopRef.current; i++) {
          setSending(
            `Uploading ${localeLabel(locale)} · ${ascDisplayTypeLabel(slot)} · ${i + 1} of ${n} (${done} done)`,
          );
          const image = await prepareStoreImage(await render(locale, slot, i));
          URL.revokeObjectURL(image.previewUrl);
          await ascUploadFn({
            data: {
              appId,
              locale,
              displayType: slot,
              fileName: image.fileName,
              dataBase64: image.base64,
            },
          });
          done++;
        }
      }
    }
    return { done, skipped };
  };

  const sendPlay = async () => {
    // Read every language first: a change opened in between would be thrown away.
    const existingBy: Record<string, Record<string, StoreImage[]>> = {};
    for (const locale of toSend) {
      if (stopRef.current) return { done: 0, skipped: [] };
      setSending(`Looking at ${localeLabel(locale)}…`);
      const { groups } = await playListFn({ data: { appId, language: locale } });
      existingBy[locale] = Object.fromEntries(groups.map((g) => [g.key, g.images]));
    }
    if (replace && slotsNow.includes("phoneScreenshots") && captures.length < 2)
      throw new Error("Google Play needs at least 2 phone screenshots. Add another capture.");
    let editId: string | null = null;
    let done = 0;
    const skipped: string[] = [];
    try {
      setSending("Opening the change…");
      editId = (await playStartFn({ data: { appId } })).editId;
      for (const locale of toSend) {
        for (const slot of slotsNow) {
          if (stopRef.current) throw new Error("Stopped.");
          const existing = existingBy[locale][slot] ?? [];
          const max = PLAY_IMAGE_RULES[slot].max;
          if (replace) {
            for (const img of existing) {
              setSending(`Removing the old ${localeLabel(locale)} ones…`);
              await playChangeFn({
                data: {
                  appId,
                  editId,
                  language: locale,
                  imageType: slot,
                  change: { kind: "delete", imageId: img.id },
                },
              });
            }
          }
          const n = screenshotRoom(max, existing.length, captures.length, replace);
          const label = slots.find((s) => s.type === slot)?.label ?? slot;
          if (n < captures.length) skipped.push(`${localeLabel(locale)} · ${label}`);
          for (let i = 0; i < n; i++) {
            if (stopRef.current) throw new Error("Stopped.");
            setSending(
              `Adding ${localeLabel(locale)} · ${label} · ${i + 1} of ${n} (${done} done)`,
            );
            const image = await prepareStoreImage(await render(locale, slot, i));
            URL.revokeObjectURL(image.previewUrl);
            await playChangeFn({
              data: {
                appId,
                editId,
                language: locale,
                imageType: slot,
                change: {
                  kind: "upload",
                  contentType: image.contentType as "image/png" | "image/jpeg",
                  dataBase64: image.base64,
                },
              },
            });
            done++;
          }
        }
      }
      setSending("Sending to Google…");
      const r = await playCommitFn({ data: { appId, editId } });
      editId = null;
      toast.success(r.message, { duration: 10000 });
      return { done, skipped };
    } finally {
      if (editId) await playDiscardFn({ data: { appId, editId } }).catch(() => {});
    }
  };

  const send = async () => {
    stopRef.current = false;
    setSending("Starting…");
    try {
      const { done, skipped } = store === "ios" ? await sendIos() : await sendPlay();
      if (stopRef.current) {
        toast.info(
          store === "ios"
            ? `Stopped. ${done} screenshot${done === 1 ? " was" : "s were"} uploaded before stopping.`
            : "Stopped. Nothing was sent to Google Play.",
          { duration: 15000 },
        );
      } else {
        if (store === "ios")
          toast.success(
            `${done} screenshot${done === 1 ? "" : "s"} uploaded. Apple takes a minute to process them.`,
            { duration: 10000 },
          );
        if (skipped.length)
          toast.warning(
            `Some didn't fit, because those slots were full (tick «Replace» to change them): ${skipped.join(", ")}.`,
            { duration: 20000 },
          );
        onClose();
      }
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Stopped.") toast.info("Stopped. Nothing was sent to Google Play.");
      else toast.error(message, { duration: 20000 });
    } finally {
      setSending(null);
      qc.invalidateQueries({ queryKey: ["store-images", store, appId] });
    }
  };

  const working = asking || !!turnId;
  const busy = working || !!sending;
  const s = q.data && q.data.id === turnId ? q.data : null;
  const progress = !turnId
    ? "Asking Claude…"
    : s?.state === "running"
      ? "Claude is designing the screenshots and writing them in every language…"
      : s?.state === "waiting" && s.waitingFor
        ? `Claude will design them after ${s.waitingFor}…`
        : "Claude will design them in a moment…";
  const total = toSend.length * slotsNow.length * captures.length;
  const shownLocales = design ? toSend.filter((l) => design.captions[l]) : [];
  const firstShown = shownLocales[0];
  const shownOk = shownLocales.includes(shownLocale);
  useEffect(() => {
    if (firstShown && !shownOk) setShownLocale(firstShown);
  }, [firstShown, shownOk]);

  return (
    <Dialog open onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Screenshots for every language and device</DialogTitle>
          <DialogDescription>
            Add captures of the game once and say the style you want. Claude designs the screenshots
            and writes their lines in every language you tick; the console makes them at each
            device's size and{" "}
            {store === "ios"
              ? "uploads them to the version being prepared in App Store Connect"
              : "sends them to Google Play in one change"}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {captures.length} / {maxCaptures} captures
            </span>
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
              disabled={busy || captures.length >= maxCaptures}
              onClick={() => input.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" /> Add captures of the game
            </Button>
          </div>

          {captures.length === 0 ? (
            <p className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Start with real captures of the game (from the preview, a phone or the simulator). The
              same captures are used for every language and device. Claude doesn't draw: it puts
              them in a frame, over a background, with a line of text.
            </p>
          ) : (
            <>
              {design && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Showing</span>
                  <Select value={shownLocale} onValueChange={setShownLocale} disabled={busy}>
                    <SelectTrigger className="h-8 w-auto text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {shownLocales.map((l) => (
                        <SelectItem key={l} value={l}>
                          {localeLabel(l)}
                          {emptyLines.includes(l) ? " (lines missing)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={shownSlot} onValueChange={setShownSlot} disabled={busy}>
                    <SelectTrigger className="h-8 w-auto text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {slots.map((sl) => (
                        <SelectItem key={sl.type} value={sl.type}>
                          {sl.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                        disabled={busy}
                        onClick={() => removeCapture(i)}
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded bg-background/80 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {design && design.captions[shownLocale] ? (
                      <Input
                        value={design.captions[shownLocale][i] ?? ""}
                        maxLength={CAPTION_MAX}
                        placeholder={`Line in ${localeLabel(shownLocale)}`}
                        className="h-8 text-xs"
                        disabled={busy}
                        onChange={(e) =>
                          setDesign((d) =>
                            d
                              ? {
                                  ...d,
                                  captions: {
                                    ...d.captions,
                                    [shownLocale]: d.captions[shownLocale].map((t, k) =>
                                      k === i ? e.target.value : t,
                                    ),
                                  },
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
                        disabled={busy}
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
            </>
          )}

          <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">
                  Languages · {chosenLocales.length} of {locales.length}
                </p>
                <div className="flex gap-2 text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    className="hover:text-foreground disabled:opacity-40"
                    disabled={busy}
                    onClick={() => setChosenLocales(locales)}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className="hover:text-foreground disabled:opacity-40"
                    disabled={busy}
                    onClick={() => setChosenLocales([main])}
                  >
                    Only {localeLabel(main)}
                  </button>
                </div>
              </div>
              <div className="grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded border border-border p-2 sm:grid-cols-3">
                {locales.map((l) => (
                  <label key={l} className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={chosenLocales.includes(l)}
                      disabled={busy}
                      onCheckedChange={(on) =>
                        setChosenLocales((all) =>
                          on ? [...all.filter((x) => x !== l), l] : all.filter((x) => x !== l),
                        )
                      }
                    />
                    <span className="truncate">{localeLabel(l)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Devices</p>
              <div className="space-y-1 rounded border border-border p-2">
                {slots.map((sl) => (
                  <label key={sl.type} className="flex items-start gap-1.5 text-xs">
                    <Checkbox
                      className="mt-0.5"
                      checked={slotsNow.includes(sl.type)}
                      disabled={busy}
                      onCheckedChange={(on) =>
                        setChosenSlots(
                          on
                            ? [...slotsNow.filter((x) => x !== sl.type), sl.type]
                            : slotsNow.filter((x) => x !== sl.type),
                        )
                      }
                    />
                    <span>
                      {sl.label}
                      {sl.hint && <span className="text-muted-foreground"> · {sl.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
              <label className="flex items-start gap-1.5 text-xs">
                <Checkbox
                  className="mt-0.5"
                  checked={replace}
                  disabled={busy}
                  onCheckedChange={(on) => setReplace(!!on)}
                />
                <span>
                  Replace the screenshots there now
                  <span className="block text-[11px] text-muted-foreground">
                    {replace
                      ? "The ones in the ticked languages and devices are removed first."
                      : "Off: the new ones go after the ones there now, while they fit."}
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="screenshot-style-all" className="text-xs font-medium">
              {design ? "What should change?" : "The style you want"}
            </label>
            <Textarea
              id="screenshot-style-all"
              rows={3}
              maxLength={2000}
              value={design ? changes : style}
              disabled={busy}
              placeholder={
                design
                  ? "e.g. warmer colours, the text at the bottom, a shorter line on the third one"
                  : "e.g. sky blue background with clouds, big yellow text on top, fun and for kids"
              }
              onChange={(e) => (design ? setChanges : setStyle)(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Claude runs on the build server like the Build chat; with many languages it takes a
              few minutes and uses a little of its weekly share.
              {sending && " Keep this page open until it finishes."}
            </p>
          </div>

          {design && (unwritten.length > 0 || emptyLines.length > 0) && (
            <p className="text-xs text-amber-600">
              {unwritten.length > 0
                ? `No lines yet in ${unwritten.map(localeLabel).join(", ")}: ask Claude for changes and it will write them.`
                : `Some lines are empty in ${emptyLines.map(localeLabel).join(", ")}: write them, or ask Claude for changes.`}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            {working || sending ? (
              <span className="mr-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {sending ?? progress}
                {(turnId || sending) && (
                  <button
                    onClick={() => (sending ? (stopRef.current = true) : stop())}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    title="Stop"
                  >
                    <Square className="h-3 w-3" /> Stop
                  </button>
                )}
              </span>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClose} disabled={!!sending}>
              Cancel
            </Button>
            <Button
              variant={design ? "outline" : "default"}
              size="sm"
              className="gap-1.5"
              disabled={
                busy ||
                captures.length === 0 ||
                chosenLocales.length === 0 ||
                (!!design && !changes.trim() && unwritten.length === 0)
              }
              onClick={ask}
            >
              <Sparkles className="h-4 w-4" />
              {design
                ? unwritten.length && !changes.trim()
                  ? "Ask Claude for the missing languages"
                  : "Ask Claude for changes"
                : "Ask Claude"}
            </Button>
            {design && (
              <Button size="sm" className="gap-1.5" disabled={busy || !sendable} onClick={send}>
                {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                {store === "ios"
                  ? `Upload ${total} to the App Store`
                  : `Send ${total} to Google Play`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
