import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, Plus, Save, Trash2 } from "lucide-react";
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
  getPlayImages,
  getPlayListing,
  removePlayLanguage,
  savePlayDetails,
  savePlayListing,
} from "@/lib/store-listing.functions";
import {
  PLAY_LANGUAGES,
  PLAY_LIMITS,
  changedFields,
  localeLabel,
  overLimit,
  type PlayDetails,
  type PlayFields,
  type PlayTextField,
} from "@/lib/store-listing";
import {
  AddLanguageDialog,
  LanguageSelect,
  LimitedField,
  Notice,
  RefreshButton,
  ScreenshotStrip,
} from "@/components/StoreListingParts";

const FIELDS: {
  key: PlayTextField;
  label: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
}[] = [
  { key: "title", label: "App name", hint: "The app's name on Google Play." },
  {
    key: "shortDescription",
    label: "Short description",
    hint: "The first line people read, under the screenshots.",
    multiline: true,
    rows: 2,
  },
  { key: "fullDescription", label: "Full description", multiline: true, rows: 12 },
  { key: "video", label: "Promo video", hint: "A YouTube link. Leave empty for none." },
];

const EMPTY_FIELDS: PlayFields = {
  title: "",
  shortDescription: "",
  fullDescription: "",
  video: "",
};

export function PlayListingPanel({ appId }: { appId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getPlayListing);
  const imagesFn = useServerFn(getPlayImages);
  const saveFn = useServerFn(savePlayListing);
  const saveDetailsFn = useServerFn(savePlayDetails);
  const removeFn = useServerFn(removePlayLanguage);

  const q = useQuery({
    queryKey: ["store-listing", "play", appId],
    queryFn: () => getFn({ data: { appId } }),
    refetchOnWindowFocus: false,
  });

  const [language, setLanguage] = useState<string | null>(null);
  // A language added here exists only in the browser until its first save, so an
  // untranslated copy never goes to Google for review.
  const [newLanguage, setNewLanguage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PlayFields>>({});
  const [detailsDraft, setDetailsDraft] = useState<PlayDetails | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "remove" | "details" | null>(null);

  const listing = q.data;
  const listings = listing?.listings ?? [];
  const defaultLanguage = listing?.defaultLanguage ?? listings[0]?.language ?? null;
  const defaultFields =
    listings.find((l) => l.language === defaultLanguage)?.fields ?? EMPTY_FIELDS;
  const codes = [...listings.map((l) => l.language), ...(newLanguage ? [newLanguage] : [])];
  const selected =
    (language && codes.includes(language) ? language : null) ?? defaultLanguage ?? codes[0] ?? null;
  const isNew = selected !== null && selected === newLanguage;
  const original = isNew
    ? EMPTY_FIELDS
    : (listings.find((l) => l.language === selected)?.fields ?? EMPTY_FIELDS);
  const draft = (selected && drafts[selected]) || original;
  const changes = changedFields(original, draft);
  const changeCount = Object.keys(changes).length;
  const tooLong = overLimit(draft, PLAY_LIMITS);
  const details = detailsDraft ?? listing?.details ?? { contactEmail: "", contactWebsite: "" };
  const detailChanges = listing?.details ? changedFields(listing.details, details) : {};

  const invalidate = () => qc.invalidateQueries({ queryKey: ["store-listing", "play", appId] });
  const dropDraft = (code: string) =>
    setDrafts((d) => {
      const { [code]: _, ...rest } = d;
      return rest;
    });

  const imagesQ = useQuery({
    queryKey: ["store-images", "play", appId, selected],
    queryFn: () => imagesFn({ data: { appId, language: selected! } }),
    enabled: !!selected && !isNew && !listing?.error,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const saveM = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          appId,
          language: selected!,
          // A new language is created whole; an existing one only gets what changed.
          fields: isNew ? draft : changes,
          create: isNew || undefined,
        },
      }),
    onSuccess: (r) => {
      toast.success(r.message, { duration: 10000 });
      if (isNew) setNewLanguage(null);
      dropDraft(selected!);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 20000 }),
  });

  const detailsM = useMutation({
    mutationFn: () => saveDetailsFn({ data: { appId, details: detailChanges } }),
    onSuccess: (r) => {
      toast.success(r.message, { duration: 10000 });
      setDetailsDraft(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 20000 }),
  });

  const removeM = useMutation({
    mutationFn: (code: string) => removeFn({ data: { appId, language: code } }),
    onSuccess: (r, code) => {
      toast.success(r.message, { duration: 10000 });
      dropDraft(code);
      setLanguage(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 20000 }),
  });

  if (q.isLoading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the Google Play listing…
      </p>
    );
  }
  if (q.error) return <Notice tone="error" title={(q.error as Error).message} />;
  if (!listing?.available) {
    return (
      <Notice tone="error" title="Google Play isn't connected to this console.">
        The console has no Google Play service account, so it can&apos;t read or change the listing.
      </Notice>
    );
  }
  if (listing.error) {
    return (
      <Notice tone="error" title="Couldn't read the Google Play listing.">
        <p>{listing.error}</p>
        <RefreshButton fetching={q.isFetching} onClick={() => q.refetch()} className="mt-2" />
      </Notice>
    );
  }

  const marks: Record<string, string> = {};
  if (defaultLanguage) marks[defaultLanguage] = "default";
  if (newLanguage) marks[newLanguage] = "new, not saved";
  for (const code of Object.keys(drafts)) {
    if (code !== selected && !marks[code]) marks[code] = "unsaved";
  }
  const titleMissing = !draft.title.trim();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{listing.packageName}</span>
          {defaultLanguage && <> · default language {localeLabel(defaultLanguage)}</>}
        </p>
        <div className="flex items-center gap-3">
          <RefreshButton
            fetching={q.isFetching}
            onClick={() => {
              invalidate();
              qc.invalidateQueries({ queryKey: ["store-images", "play", appId] });
            }}
          />
          <a
            href="https://play.google.com/console"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Play Console <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <Notice title="This is what players see now.">
        Saved changes go to Google for review first, usually approved within a day. No new build is
        needed.
      </Notice>

      {selected && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSelect
              value={selected}
              languages={codes}
              marks={marks}
              onChange={setLanguage}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setAdding(true)}
              disabled={!!newLanguage}
              title={newLanguage ? "Save or discard the new language first" : undefined}
            >
              <Plus className="h-4 w-4" /> Add language
            </Button>
            {selected !== defaultLanguage && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => {
                  if (isNew) {
                    setNewLanguage(null);
                    dropDraft(selected);
                  } else {
                    setConfirm("remove");
                  }
                }}
              >
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            )}
          </div>

          {isNew && (
            <Notice tone="warn" title={`${localeLabel(selected)} is not on Google Play yet.`}>
              It was filled in from {defaultLanguage ? localeLabel(defaultLanguage) : "the default"}
              . Translate it, then save to send it to Google.
            </Notice>
          )}

          <div className="space-y-4">
            {FIELDS.map((f) => (
              <LimitedField
                key={f.key}
                id={`play-${f.key}`}
                label={f.label}
                hint={f.hint}
                value={draft[f.key]}
                limit={PLAY_LIMITS[f.key]}
                multiline={f.multiline}
                rows={f.rows}
                placeholder={f.key === "video" ? "https://www.youtube.com/watch?v=…" : undefined}
                showCount={f.key !== "video"}
                changed={!isNew && f.key in changes}
                onChange={(value) =>
                  setDrafts((d) => ({ ...d, [selected]: { ...draft, [f.key]: value } }))
                }
              />
            ))}
          </div>

          {(changeCount > 0 || isNew) && (
            <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
              <p className="text-xs text-muted-foreground">
                {isNew
                  ? `New language: ${localeLabel(selected)}.`
                  : `${changeCount} unsaved change${changeCount === 1 ? "" : "s"} in ${localeLabel(selected)}.`}{" "}
                {titleMissing && "The app name can't be empty."}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    dropDraft(selected);
                    if (isNew) setNewLanguage(null);
                  }}
                  disabled={saveM.isPending}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setConfirm("save")}
                  disabled={saveM.isPending || tooLong.length > 0 || titleMissing}
                >
                  {saveM.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Send to Google Play
                </Button>
              </div>
            </div>
          )}

          {!isNew && (
            <div className="space-y-2 pt-2">
              <h3 className="text-sm font-medium">Graphics · {localeLabel(selected)}</h3>
              <ScreenshotStrip
                groups={imagesQ.data?.groups}
                loading={imagesQ.isLoading}
                error={imagesQ.error as Error | null}
                empty="No graphics for this language."
              />
              <p className="text-xs text-muted-foreground">
                To change the icon, feature graphic or screenshots, use Play Console → Grow users →
                Store presence → Main store listing.
              </p>
            </div>
          )}
        </>
      )}

      <div className="space-y-3 rounded-md border border-border p-4">
        <div>
          <h3 className="text-sm font-medium">Contact details</h3>
          <p className="text-xs text-muted-foreground">
            Shown on the listing in every language. Google requires the email.
          </p>
        </div>
        <LimitedField
          id="play-contact-email"
          label="Email"
          value={details.contactEmail}
          limit={255}
          showCount={false}
          changed={"contactEmail" in detailChanges}
          onChange={(v) => setDetailsDraft({ ...details, contactEmail: v })}
        />
        <LimitedField
          id="play-contact-website"
          label="Website"
          value={details.contactWebsite}
          limit={255}
          showCount={false}
          placeholder="https://"
          changed={"contactWebsite" in detailChanges}
          onChange={(v) => setDetailsDraft({ ...details, contactWebsite: v })}
        />
        {Object.keys(detailChanges).length > 0 && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDetailsDraft(null)}>
              Discard
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setConfirm("details")}
              disabled={detailsM.isPending || !details.contactEmail.trim()}
            >
              {detailsM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Send to Google Play
            </Button>
          </div>
        )}
      </div>

      <AddLanguageDialog
        open={adding}
        onOpenChange={setAdding}
        options={PLAY_LANGUAGES.filter((c) => !codes.includes(c))}
        description={`The new language starts as a copy of ${defaultLanguage ? localeLabel(defaultLanguage) : "the default language"}. Nothing is sent to Google until you save it.`}
        onAdd={(code) => {
          setNewLanguage(code);
          setDrafts((d) => ({ ...d, [code]: { ...defaultFields } }));
          setLanguage(code);
          setAdding(false);
        }}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "remove"
                ? `Remove ${selected ? localeLabel(selected) : "this language"} from Google Play?`
                : "Send this to Google for review?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "remove"
                ? `Players who use that language will see the ${defaultLanguage ? localeLabel(defaultLanguage) : "default"} listing instead, once Google approves the change.`
                : "Google checks listing changes before they appear, usually within a day. Until then players keep seeing the current listing."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirm === "remove"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                if (confirm === "save") saveM.mutate();
                if (confirm === "details") detailsM.mutate();
                if (confirm === "remove" && selected) removeM.mutate(selected);
                setConfirm(null);
              }}
            >
              {confirm === "remove" ? "Remove" : "Send"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
