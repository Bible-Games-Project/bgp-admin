import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  addAppStoreLocale,
  getAppStoreListing,
  getAppStoreScreenshots,
  prepareNextAppStoreVersion,
  removeAppStoreLocale,
  saveAppStoreLocale,
  type AscView,
} from "@/lib/store-listing.functions";
import {
  ASC_LIMITS,
  ASC_LOCALES,
  ASC_INFO_FIELDS,
  changedFields,
  localeLabel,
  overLimit,
  type AscFields,
  type AscTextField,
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
  key: AscTextField;
  label: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  url?: boolean;
}[] = [
  { key: "name", label: "Name", hint: "The app's name on the App Store." },
  { key: "subtitle", label: "Subtitle", hint: "One short line shown under the name." },
  {
    key: "promotionalText",
    label: "Promotional text",
    hint: "Shown above the description. The only text that can change without a new version.",
    multiline: true,
    rows: 3,
  },
  { key: "description", label: "Description", multiline: true, rows: 12 },
  {
    key: "keywords",
    label: "Keywords",
    hint: "Comma-separated search terms. Players never see them; don't repeat words from the name.",
  },
  { key: "supportUrl", label: "Support URL", url: true },
  { key: "marketingUrl", label: "Marketing URL", url: true },
  { key: "privacyPolicyUrl", label: "Privacy policy URL", url: true },
];

function fieldEditable(view: AscView, key: AscTextField) {
  if (key === "promotionalText") return view.promoEditable;
  if (ASC_INFO_FIELDS.includes(key)) return view.infoEditable;
  return view.versionEditable;
}

export function AppStoreListingPanel({ appId }: { appId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getAppStoreListing);
  const saveFn = useServerFn(saveAppStoreLocale);
  const prepareFn = useServerFn(prepareNextAppStoreVersion);
  const addFn = useServerFn(addAppStoreLocale);
  const removeFn = useServerFn(removeAppStoreLocale);
  const screenshotsFn = useServerFn(getAppStoreScreenshots);

  const queryKey = ["store-listing", "ios", appId];
  const q = useQuery({
    queryKey,
    queryFn: () => getFn({ data: { appId } }),
    refetchOnWindowFocus: false,
  });

  const [viewKind, setViewKind] = useState<"live" | "next" | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  // Unsaved edits per "view:locale", so switching language never loses work.
  const [drafts, setDrafts] = useState<Record<string, AscFields>>({});
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const listing = q.data;
  const views = listing?.views ?? [];
  const view = views.find((v) => v.kind === viewKind) ?? views[0] ?? null;
  const primary = listing?.primaryLocale ?? "en-US";
  const current =
    view?.locales.find((l) => l.locale === locale) ??
    view?.locales.find((l) => l.locale === primary) ??
    view?.locales[0] ??
    null;
  const draftKey = view && current ? `${view.kind}:${current.locale}` : "";
  const draft = drafts[draftKey] ?? current?.fields ?? null;
  const changes = current && draft ? changedFields(current.fields, draft) : {};
  const changeCount = Object.keys(changes).length;
  const tooLong = draft ? overLimit(draft, ASC_LIMITS) : [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["store-listing", "ios", appId] });
  const dropDraft = (key: string) =>
    setDrafts((d) => {
      const { [key]: _, ...rest } = d;
      return rest;
    });

  const screenshotsQ = useQuery({
    queryKey: ["store-images", "ios", appId, view?.kind, current?.locale],
    queryFn: () => screenshotsFn({ data: { appId, view: view!.kind, locale: current!.locale } }),
    enabled: !!view && !!current,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const saveM = useMutation({
    mutationFn: () =>
      saveFn({
        data: { appId, view: view!.kind, locale: current!.locale, fields: changes },
      }),
    onSuccess: (r) => {
      toast.success(r.message, { duration: 8000 });
      dropDraft(draftKey);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const prepareM = useMutation({
    mutationFn: () => prepareFn({ data: { appId } }),
    onSuccess: (r) => {
      toast.success(r.message, { duration: 10000 });
      setViewKind("next");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const addM = useMutation({
    mutationFn: (code: string) =>
      addFn({ data: { appId, locale: code as (typeof ASC_LOCALES)[number] } }),
    onSuccess: (r, code) => {
      toast.success(r.message, { duration: 10000 });
      setAdding(false);
      setViewKind("next");
      setLocale(code);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const removeM = useMutation({
    mutationFn: (code: string) => removeFn({ data: { appId, locale: code } }),
    onSuccess: (r) => {
      toast.success(r.message, { duration: 10000 });
      dropDraft(draftKey);
      setLocale(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  if (q.isLoading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the App Store listing…
      </p>
    );
  }
  if (q.error) return <Notice tone="error" title={(q.error as Error).message} />;
  if (!listing?.available) {
    return (
      <Notice tone="error" title="App Store Connect isn't connected to this console.">
        The console has no App Store Connect API key, so it can't read or change the listing.
      </Notice>
    );
  }
  if (listing.error) {
    return (
      <Notice tone="error" title={listing.error}>
        {listing.notFound ? (
          <>
            Create the app in App Store Connect first — the Setup tab&apos;s Store Listings step has
            the exact values to enter — then refresh.
          </>
        ) : null}
        <RefreshButton fetching={q.isFetching} onClick={() => q.refetch()} className="mt-2" />
      </Notice>
    );
  }

  const live = views.find((v) => v.kind === "live");
  const next = views.find((v) => v.kind === "next");
  const nextOpen = !!next?.versionEditable;
  const ascUrl = `https://appstoreconnect.apple.com/apps/${listing.ascAppId}/distribution`;
  const localeCodes = view?.locales.map((l) => l.locale) ?? [];
  const marks: Record<string, string> = { [primary]: "primary" };
  for (const key of Object.keys(drafts)) {
    const [k, code] = key.split(":");
    if (k === view?.kind && code !== current?.locale) marks[code] = "unsaved";
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {views.length > 1 ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view?.kind}
            onValueChange={(v) => v && setViewKind(v as "live" | "next")}
          >
            <ToggleGroupItem value="live">On the App Store · {live?.versionString}</ToggleGroupItem>
            <ToggleGroupItem value="next">
              {nextOpen ? "Next version" : "In review"} · {next?.versionString}
            </ToggleGroupItem>
          </ToggleGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            {view?.kind === "live"
              ? `On the App Store · version ${view.versionString}`
              : view
                ? `Not on the App Store yet · version ${view.versionString}`
                : "No version yet"}
          </p>
        )}
        <div className="flex items-center gap-3">
          <RefreshButton
            fetching={q.isFetching}
            onClick={() => {
              invalidate();
              qc.invalidateQueries({ queryKey: ["store-images", "ios", appId] });
            }}
          />
          <a
            href={ascUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            App Store Connect <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {view && (
        <ViewNotice
          view={view}
          next={next ?? null}
          hasLive={!!live}
          canPrepare={listing.canPrepare ?? null}
          preparing={prepareM.isPending}
          onPrepare={() => prepareM.mutate()}
          onShowNext={() => setViewKind("next")}
        />
      )}

      {view && current && draft && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSelect
              value={current.locale}
              languages={localeCodes}
              marks={marks}
              onChange={setLocale}
            />
            {view.kind === "next" && view.infoEditable && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setAdding(true)}
                >
                  <Plus className="h-4 w-4" /> Add language
                </Button>
                {current.locale !== primary && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => setConfirmRemove(true)}
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                )}
              </>
            )}
          </div>

          <div className="space-y-4">
            {FIELDS.map((f) => (
              <LimitedField
                key={f.key}
                id={`asc-${f.key}`}
                label={f.label}
                hint={f.hint}
                value={draft[f.key]}
                limit={ASC_LIMITS[f.key]}
                multiline={f.multiline}
                rows={f.rows}
                placeholder={f.url ? "https://" : undefined}
                showCount={!f.url}
                readOnly={!fieldEditable(view, f.key)}
                changed={f.key in changes}
                onChange={(value) =>
                  setDrafts((d) => ({ ...d, [draftKey]: { ...draft, [f.key]: value } }))
                }
              />
            ))}
          </div>

          {changeCount > 0 && (
            <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
              <p className="text-xs text-muted-foreground">
                {changeCount} unsaved change{changeCount === 1 ? "" : "s"} in{" "}
                {localeLabel(current.locale)}.{" "}
                {view.kind === "live"
                  ? "Promotional text shows on the App Store within minutes."
                  : `Goes live with version ${view.versionString}.`}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dropDraft(draftKey)}
                  disabled={saveM.isPending}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => saveM.mutate()}
                  disabled={saveM.isPending || tooLong.length > 0 || !draft.name.trim()}
                >
                  {saveM.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save to App Store Connect
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <h3 className="text-sm font-medium">Screenshots · {localeLabel(current.locale)}</h3>
            <ScreenshotStrip
              groups={screenshotsQ.data?.groups}
              loading={screenshotsQ.isLoading}
              error={screenshotsQ.error as Error | null}
              empty="No screenshots for this language on this version."
            />
            <p className="text-xs text-muted-foreground">
              To add, remove or reorder screenshots, use{" "}
              <a href={ascUrl} target="_blank" rel="noreferrer" className="underline">
                App Store Connect
              </a>{" "}
              → the version → the language.
            </p>
          </div>
        </>
      )}

      <AddLanguageDialog
        open={adding}
        onOpenChange={setAdding}
        options={ASC_LOCALES.filter((c) => !localeCodes.includes(c))}
        pending={addM.isPending}
        description={`The new language starts as a copy of ${localeLabel(primary)}. Translate it here before the next release.`}
        onAdd={(code) => addM.mutate(code)}
      />

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {current ? localeLabel(current.locale) : "this language"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its texts are deleted from version {view?.versionString}. Players who use that
              language see the {localeLabel(primary)} listing once the version is released.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => current && removeM.mutate(current.locale)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ViewNotice({
  view,
  next,
  hasLive,
  canPrepare,
  preparing,
  onPrepare,
  onShowNext,
}: {
  view: AscView;
  next: AscView | null;
  hasLive: boolean;
  canPrepare: string | null;
  preparing: boolean;
  onPrepare: () => void;
  onShowNext: () => void;
}) {
  if (view.kind === "next") {
    if (!view.versionEditable) {
      return (
        <Notice tone="warn" title={`Apple is reviewing version ${view.versionString}.`}>
          Nothing on it can change until the review ends. Once it is live, prepare the next version
          here to make more changes.
        </Notice>
      );
    }
    return (
      <Notice
        title={
          hasLive
            ? `Version ${view.versionString} isn't live yet.`
            : "This app isn't on the App Store yet."
        }
      >
        Changes saved here go live when this version is released with{" "}
        <Link to="/dashboard" className="underline">
          Release to Production
        </Link>
        . What&apos;s New is written there too, when you release.
      </Notice>
    );
  }

  return (
    <Notice title="This is what players see now.">
      Only the promotional text can change without a new version.{" "}
      {next?.versionEditable ? (
        <>
          The rest is edited on{" "}
          <button onClick={onShowNext} className="underline text-foreground">
            version {next.versionString}
          </button>
          , which goes live with the next release.
        </>
      ) : next ? (
        <>
          Version {next.versionString} is with Apple for review; the rest can be edited once it is
          live.
        </>
      ) : canPrepare ? (
        <span className="block mt-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={onPrepare}
            disabled={preparing}
          >
            {preparing && <Loader2 className="h-3 w-3 animate-spin" />}
            Prepare next version to edit the rest
          </Button>
          <span className="block mt-1.5">
            It opens version {canPrepare}, starting from this listing. Nothing reaches players until
            the next Release to Production.
          </span>
        </span>
      ) : null}
    </Notice>
  );
}
