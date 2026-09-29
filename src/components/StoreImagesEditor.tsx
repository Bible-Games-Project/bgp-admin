import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  changePlayImage,
  commitPlayImageEdit,
  deleteAppStoreScreenshot,
  discardPlayImageEdit,
  getAppStoreScreenshots,
  getPlayImages,
  moveAppStoreScreenshot,
  startPlayImageEdit,
  uploadAppStoreScreenshot,
} from "@/lib/store-listing.functions";
import {
  ASC_MAX_SCREENSHOTS,
  ASC_UPLOAD_SLOTS,
  PLAY_IMAGE_RULES,
  PLAY_IMAGE_TYPES,
  ascDisplayTypeLabel,
  ascDisplayTypeRank,
  ascSizeProblem,
  localeLabel,
  playSizeProblem,
  type StoreImage,
} from "@/lib/store-listing";
import { prepareStoreImage, readImageSize, type PreparedImage } from "@/lib/store-image-file";
import { cn } from "@/lib/utils";

/** One image with its controls underneath, so they also work on a phone. */
function Thumb({
  image,
  heightClass,
  children,
}: {
  image: Pick<StoreImage, "url" | "state" | "error">;
  heightClass: string;
  children?: ReactNode;
}) {
  return (
    <div className="shrink-0 space-y-1">
      {image.url ? (
        <img
          src={image.url}
          alt=""
          loading="lazy"
          className={cn(heightClass, "w-auto rounded border border-border bg-muted object-contain")}
        />
      ) : (
        <div
          className={cn(
            heightClass,
            "w-20 rounded border border-dashed grid place-items-center text-[10px] text-center px-1",
            image.state === "failed"
              ? "border-destructive text-destructive"
              : "border-border text-muted-foreground",
          )}
        >
          {image.state === "failed" ? "Failed" : "Processing…"}
        </div>
      )}
      {image.error && (
        <p className="w-28 text-[10px] leading-tight text-destructive">{image.error}</p>
      )}
      {children && <div className="flex justify-center gap-0.5">{children}</div>}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function AddImagesButton({
  label,
  multiple,
  disabled,
  onFiles,
}: {
  label: string;
  multiple: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1.5"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <ImagePlus className="h-3.5 w-3.5" /> {label}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------------------------ */
/* App Store: every change applies at once — the version isn't live, so nothing reaches  */
/* players until it is released.                                                         */
/* ------------------------------------------------------------------------------------ */

export function AscScreenshotsEditor({
  appId,
  viewKind,
  locale,
  editable,
  readOnlyNote,
}: {
  appId: string;
  viewKind: "live" | "next";
  locale: string;
  editable: boolean;
  readOnlyNote: ReactNode;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(getAppStoreScreenshots);
  const uploadFn = useServerFn(uploadAppStoreScreenshot);
  const deleteFn = useServerFn(deleteAppStoreScreenshot);
  const moveFn = useServerFn(moveAppStoreScreenshot);
  const [busy, setBusy] = useState<string | null>(null);

  const queryKey = ["store-images", "ios", appId, viewKind, locale];
  const q = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { appId, view: viewKind, locale } }),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    // Apple processes uploads for a minute or so; keep looking until it is done.
    refetchInterval: (query) =>
      query.state.data?.groups.some((g) => g.images.some((i) => i.state === "processing"))
        ? 5000
        : false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey });

  const groups = q.data?.groups ?? [];
  const rows = editable
    ? [
        ...ASC_UPLOAD_SLOTS.filter((s) => s.always || groups.some((g) => g.key === s.type)).map(
          (s) => s.type,
        ),
        ...groups.map((g) => g.key).filter((k) => !ASC_UPLOAD_SLOTS.some((s) => s.type === k)),
      ].sort((a, b) => ascDisplayTypeRank(a) - ascDisplayTypeRank(b))
    : groups.map((g) => g.key);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await action();
    } catch (e) {
      toast.error((e as Error).message, { duration: 15000 });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const upload = (type: string, files: File[], room: number) =>
    run("upload", async () => {
      if (files.length > room) {
        toast.warning(`Only ${room} more fit${room === 1 ? "s" : ""}; the rest were skipped.`);
      }
      let done = 0;
      for (const file of files.slice(0, room)) {
        const { width, height } = await readImageSize(file);
        const problem = ascSizeProblem(type, width, height);
        if (problem) {
          toast.error(`${file.name}: ${problem}`, { duration: 15000 });
          continue;
        }
        setBusy(`Uploading ${file.name}…`);
        const image = await prepareStoreImage(file);
        URL.revokeObjectURL(image.previewUrl);
        await uploadFn({
          data: {
            appId,
            locale,
            displayType: type,
            fileName: image.fileName,
            dataBase64: image.base64,
          },
        });
        done++;
        refresh();
      }
      if (done) {
        toast.success(
          `${done} screenshot${done === 1 ? "" : "s"} uploaded. Apple takes a minute to process them.`,
        );
      }
    });

  if (q.isLoading) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading screenshots…
      </p>
    );
  }
  if (q.error) return <p className="text-xs text-destructive">{(q.error as Error).message}</p>;

  return (
    <div className="space-y-4">
      {!editable && <p className="text-xs text-muted-foreground">{readOnlyNote}</p>}
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground">No screenshots for this language.</p>
      )}
      {rows.map((type) => {
        const images = groups.find((g) => g.key === type)?.images ?? [];
        const uploadable = editable && ASC_UPLOAD_SLOTS.some((s) => s.type === type);
        const room = ASC_MAX_SCREENSHOTS - images.length;
        return (
          <div key={type} className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {ascDisplayTypeLabel(type)} · {images.length} / {ASC_MAX_SCREENSHOTS}
                {type === "APP_IPAD_PRO_3GEN_129" && images.length === 0 && (
                  <> · only needed if the app runs on iPad</>
                )}
              </p>
              {uploadable && (
                <AddImagesButton
                  label="Add screenshots"
                  multiple
                  disabled={!!busy || room <= 0}
                  onFiles={(files) => upload(type, files, room)}
                />
              )}
            </div>
            {images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <Thumb key={img.id} image={img} heightClass="h-40">
                    {editable && (
                      <>
                        <IconButton
                          label="Move earlier"
                          disabled={!!busy || i === 0}
                          onClick={() =>
                            run("move", () =>
                              moveFn({
                                data: { appId, locale, screenshotId: img.id, direction: "earlier" },
                              }),
                            )
                          }
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label="Remove"
                          disabled={!!busy}
                          onClick={() => {
                            if (!confirm("Remove this screenshot from the version?")) return;
                            run("delete", () =>
                              deleteFn({ data: { appId, locale, screenshotId: img.id } }),
                            );
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label="Move later"
                          disabled={!!busy || i === images.length - 1}
                          onClick={() =>
                            run("move", () =>
                              moveFn({
                                data: { appId, locale, screenshotId: img.id, direction: "later" },
                              }),
                            )
                          }
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </IconButton>
                      </>
                    )}
                  </Thumb>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {busy && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {busy.startsWith("Uploading") ? busy : "Saving…"}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Google Play: changes are staged here and sent as one edit, so Google reviews them     */
/* together instead of once per image.                                                    */
/* ------------------------------------------------------------------------------------ */

type Pending = { removed: string[]; added: Record<string, PreparedImage[]> };
const NO_PENDING: Pending = { removed: [], added: {} };

export function PlayGraphicsEditor({ appId, language }: { appId: string; language: string }) {
  const qc = useQueryClient();
  const imagesFn = useServerFn(getPlayImages);
  const startFn = useServerFn(startPlayImageEdit);
  const changeFn = useServerFn(changePlayImage);
  const commitFn = useServerFn(commitPlayImageEdit);
  const discardFn = useServerFn(discardPlayImageEdit);

  // Staged changes per language, so switching language doesn't lose them.
  const [pendingBy, setPendingBy] = useState<Record<string, Pending>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const q = useQuery({
    queryKey: ["store-images", "play", appId, language],
    queryFn: () => imagesFn({ data: { appId, language } }),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const pending = pendingBy[language] ?? NO_PENDING;
  // Functional, because images are prepared asynchronously and the staged state may
  // have moved on by the time they are ready.
  const updatePending = (fn: (p: Pending) => Pending) =>
    setPendingBy((all) => ({ ...all, [language]: fn(all[language] ?? NO_PENDING) }));
  const changeCount =
    pending.removed.length + Object.values(pending.added).reduce((n, a) => n + a.length, 0);

  const discard = () => {
    Object.values(pending.added)
      .flat()
      .forEach((img) => URL.revokeObjectURL(img.previewUrl));
    updatePending(() => NO_PENDING);
  };

  const prepareFiles = async (type: string, files: File[], room: number) => {
    if (files.length > room) {
      toast.warning(`Only ${room} more fit${room === 1 ? "s" : ""}; the rest were skipped.`);
    }
    const prepared: PreparedImage[] = [];
    for (const file of files.slice(0, room)) {
      try {
        const { width, height } = await readImageSize(file);
        const problem = playSizeProblem(type, width, height);
        if (problem) {
          toast.error(`${file.name}: ${problem}`, { duration: 15000 });
          continue;
        }
        prepared.push(await prepareStoreImage(file, { keepPng: !!PLAY_IMAGE_RULES[type]?.png }));
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    return prepared;
  };

  const add = async (type: string, files: File[], room: number, replaceId?: string) => {
    const single = PLAY_IMAGE_RULES[type].max === 1;
    const prepared = await prepareFiles(type, files, single ? 1 : room);
    if (!prepared.length) return;
    updatePending((p) => {
      if (!single) {
        return { ...p, added: { ...p.added, [type]: [...(p.added[type] ?? []), ...prepared] } };
      }
      // A single-image slot is replaced: the live image and anything staged before go.
      (p.added[type] ?? []).forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return {
        removed:
          replaceId && !p.removed.includes(replaceId) ? [...p.removed, replaceId] : p.removed,
        added: { ...p.added, [type]: prepared },
      };
    });
  };

  const send = async () => {
    const total = changeCount;
    let step = 0;
    const tick = () => setProgress(`Sending ${++step} of ${total}…`);
    let editId: string | null = null;
    try {
      setProgress("Opening the change…");
      editId = (await startFn({ data: { appId } })).editId;
      for (const group of q.data?.groups ?? []) {
        for (const img of group.images.filter((i) => pending.removed.includes(i.id))) {
          tick();
          await changeFn({
            data: {
              appId,
              editId,
              language,
              imageType: group.key,
              change: { kind: "delete", imageId: img.id },
            },
          });
        }
      }
      for (const [type, list] of Object.entries(pending.added)) {
        for (const img of list) {
          tick();
          await changeFn({
            data: {
              appId,
              editId,
              language,
              imageType: type,
              change: { kind: "upload", contentType: img.contentType, dataBase64: img.base64 },
            },
          });
        }
      }
      setProgress("Sending to Google…");
      const r = await commitFn({ data: { appId, editId } });
      editId = null;
      toast.success(r.message, { duration: 10000 });
      discard();
    } catch (e) {
      toast.error((e as Error).message, { duration: 20000 });
    } finally {
      if (editId) await discardFn({ data: { appId, editId } }).catch(() => {});
      setProgress(null);
      qc.invalidateQueries({ queryKey: ["store-images", "play", appId, language] });
    }
  };

  if (q.isLoading) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading graphics…
      </p>
    );
  }
  if (q.error) return <p className="text-xs text-destructive">{(q.error as Error).message}</p>;

  return (
    <div className="space-y-4">
      {PLAY_IMAGE_TYPES.map(([type, label]) => {
        const rule = PLAY_IMAGE_RULES[type];
        const existing = (q.data?.groups.find((g) => g.key === type)?.images ?? []).filter(
          (i) => !pending.removed.includes(i.id),
        );
        const added = pending.added[type] ?? [];
        const count = existing.length + added.length;
        const room = rule.max - count;
        const height = type === "icon" ? "h-20" : type === "featureGraphic" ? "h-24" : "h-40";
        return (
          <div key={type} className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {label} · {count} / {rule.max}
                {rule.exact && (
                  <>
                    {" "}
                    · {rule.exact[0]}×{rule.exact[1]}
                  </>
                )}
                {rule.min && count < rule.min && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {" "}
                    · Google requires at least {rule.min}
                  </span>
                )}
              </p>
              <AddImagesButton
                label={rule.max === 1 && count === 1 ? "Replace" : "Add"}
                multiple={rule.max > 1}
                disabled={!!progress || (room <= 0 && rule.max > 1)}
                onFiles={(files) => void add(type, files, room, existing[0]?.id)}
              />
            </div>
            {count > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {existing.map((img) => (
                  <Thumb key={img.id} image={img} heightClass={height}>
                    <IconButton
                      label="Remove"
                      disabled={!!progress}
                      onClick={() =>
                        updatePending((p) => ({ ...p, removed: [...p.removed, img.id] }))
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                    </IconButton>
                  </Thumb>
                ))}
                {added.map((img) => (
                  <div key={img.previewUrl} className="relative">
                    <Thumb image={{ url: img.previewUrl }} heightClass={height}>
                      <IconButton
                        label="Remove"
                        disabled={!!progress}
                        onClick={() => {
                          URL.revokeObjectURL(img.previewUrl);
                          updatePending((p) => ({
                            ...p,
                            added: {
                              ...p.added,
                              [type]: (p.added[type] ?? []).filter((x) => x !== img),
                            },
                          }));
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </IconButton>
                    </Thumb>
                    <span className="absolute top-1 left-1 rounded bg-amber-500 px-1 text-[10px] font-medium text-white">
                      new
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Google Play shows images in the order they were added. To change the order, remove them and
        add them again in the order you want.
      </p>

      {(changeCount > 0 || progress) && (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
          <p className="text-xs text-muted-foreground">
            {progress ??
              `${changeCount} unsent graphic change${changeCount === 1 ? "" : "s"} in ${localeLabel(language)}.`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={discard} disabled={!!progress}>
              Discard
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setConfirming(true)}
              disabled={!!progress}
            >
              {progress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Send to Google Play
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send these graphics to Google for review?</AlertDialogTitle>
            <AlertDialogDescription>
              Google checks listing changes before they appear, usually within a day. Until then
              players keep seeing the current graphics.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                void send();
              }}
            >
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
