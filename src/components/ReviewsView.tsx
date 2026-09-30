import { useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Languages, Loader2, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LimitedField, Notice, RefreshButton } from "@/components/StoreListingParts";
import type { AppStoreIds } from "@/lib/app-kind";
import {
  APP_STORE_STOREFRONTS,
  REPLY_LIMITS,
  REVIEW_STORES,
  REVIEW_STORE_LABELS,
  STOREFRONTS_PER_CALL,
  type AppStoreRatings,
  type ReviewReply,
  type ReviewStore,
  type Sentiment,
  type StoreReview,
  type StoreReviews,
  averageStars,
  awaitsReply,
  canReplyFromConsole,
  sentimentOf,
  sumAppStoreRatings,
} from "@/lib/reviews";
import {
  deleteReviewReply,
  getAppStoreRatings,
  getAppStoreReviews,
  getGooglePlayReviews,
  getSteamReviews,
  replyToReview,
} from "@/lib/reviews.functions";
import { charCount } from "@/lib/store-listing";
import { cn } from "@/lib/utils";

export type ReviewsApp = { id: string; name: string; ids: AppStoreIds };

// New reviews arrive a few a week; ratings change even more slowly.
const REVIEWS_STALE_MS = 10 * 60 * 1000;
const RATINGS_STALE_MS = 60 * 60 * 1000;
const PAGE_SIZE = 20;

const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: "Positive (4–5 ★, 👍)",
  neutral: "Mixed (3 ★)",
  negative: "Negative (1–2 ★, 👎)",
};

const REPLY_HINTS: Record<keyof typeof REPLY_LIMITS, string> = {
  app_store:
    "Apple checks each reply before it shows on the App Store, usually within a day. Sending again replaces it.",
  google_play: "Shows on Google Play straight away. Sending again replaces it.",
};

function storeIdOf(ids: AppStoreIds, store: ReviewStore) {
  return store === "app_store" ? ids.ios : store === "google_play" ? ids.android : ids.steam;
}

const reviewsKey = (store: ReviewStore, appId: string) => ["reviews", store, appId];

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

const fmtStars = (n: number) => n.toFixed(1);

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function translateUrl(text: string) {
  const target = (typeof navigator !== "undefined" && navigator.language?.split("-")[0]) || "en";
  return `https://translate.google.com/?sl=auto&tl=${target}&op=translate&text=${encodeURIComponent(text)}`;
}

/* ------------------------------------------------------------------------------------ */
/* Data                                                                                  */
/* ------------------------------------------------------------------------------------ */

type Source = {
  app: ReviewsApp;
  store: ReviewStore;
  data?: StoreReviews;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  refetch: () => void;
};

function useReviewSources(apps: ReviewsApp[]): Source[] {
  const fns = {
    app_store: useServerFn(getAppStoreReviews),
    google_play: useServerFn(getGooglePlayReviews),
    steam: useServerFn(getSteamReviews),
  };
  const wanted = apps.flatMap((app) =>
    REVIEW_STORES.filter((store) => storeIdOf(app.ids, store)).map((store) => ({ app, store })),
  );
  const results = useQueries({
    queries: wanted.map(({ app, store }) => ({
      queryKey: reviewsKey(store, app.id),
      queryFn: () => fns[store]({ data: { appId: app.id } }),
      staleTime: REVIEWS_STALE_MS,
      refetchOnWindowFocus: false,
    })),
  });
  return wanted.map((w, i) => ({
    ...w,
    data: results[i].data,
    loading: results[i].isLoading,
    fetching: results[i].isFetching,
    error: results[i].error,
    refetch: () => void results[i].refetch(),
  }));
}

/** Every storefront's App Store rating, looked up in a few calls, added up per game. */
function useAppStoreRatings(apps: ReviewsApp[]) {
  const ratingsFn = useServerFn(getAppStoreRatings);
  const bundleIds = [
    ...new Set(apps.map((a) => a.ids.ios).filter((id): id is string => !!id)),
  ].sort();
  const chunks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < APP_STORE_STOREFRONTS.length; i += STOREFRONTS_PER_CALL) {
      out.push(APP_STORE_STOREFRONTS.slice(i, i + STOREFRONTS_PER_CALL));
    }
    return out;
  }, []);
  const results = useQueries({
    queries: bundleIds.length
      ? chunks.map((countries, i) => ({
          queryKey: ["reviews", "app_store_ratings", bundleIds.join(","), i],
          queryFn: () => ratingsFn({ data: { bundleIds, countries } }),
          staleTime: RATINGS_STALE_MS,
          refetchOnWindowFocus: false,
        }))
      : [],
  });
  const byBundle = new Map<string, AppStoreRatings>(
    bundleIds.map((id) => [
      id,
      sumAppStoreRatings(results.flatMap((r) => r.data?.ratings[id] ?? [])),
    ]),
  );
  const missed = results.reduce(
    (n, r, i) => n + (r.data ? r.data.failed.length : r.error ? chunks[i].length : 0),
    0,
  );
  return {
    byBundle,
    loading: results.some((r) => r.isLoading),
    fetching: results.some((r) => r.isFetching),
    missed,
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}

/* ------------------------------------------------------------------------------------ */
/* View                                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * Ratings and reviews of every game (the Reviews page), read live from the stores, with
 * replies sent straight back to them. The game picked lives in the page's URL, so a
 * game's page can link here with that game already picked.
 */
export function ReviewsView({
  apps,
  appFilter,
  onAppFilterChange,
  initialSentiment = "all",
  initialWaitingOnly = false,
}: {
  apps: ReviewsApp[];
  /** A game's id, or "all". */
  appFilter: string;
  onAppFilterChange: (appId: string) => void;
  /** Filters to start with, e.g. from Home's "Reply" button. */
  initialSentiment?: Sentiment | "all";
  initialWaitingOnly?: boolean;
}) {
  const sources = useReviewSources(apps);
  const ratings = useAppStoreRatings(apps);
  const many = apps.length > 1;

  const [storeFilter, setStoreFilter] = useState<ReviewStore | "all">("all");
  const [sentiment, setSentiment] = useState<Sentiment | "all">(initialSentiment);
  const [waitingOnly, setWaitingOnly] = useState(initialWaitingOnly);
  const [shown, setShown] = useState(PAGE_SIZE);
  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setShown(PAGE_SIZE);
    };

  const stores = REVIEW_STORES.filter((s) => sources.some((src) => src.store === s));
  // Google Play's exports also list bare star ratings. They count in the scores above,
  // but there is nothing to read or answer, so the list leaves them out.
  const all = sources
    .flatMap((s) => (s.data?.reviews ?? []).map((review) => ({ review, app: s.app })))
    .filter(({ review }) => review.title || review.text)
    .sort((a, b) => b.review.date.localeCompare(a.review.date));
  const visible = all.filter(
    ({ review, app }) =>
      (appFilter === "all" || app.id === appFilter) &&
      (storeFilter === "all" || review.store === storeFilter) &&
      (sentiment === "all" || sentimentOf(review) === sentiment) &&
      (!waitingOnly || awaitsReply(review)),
  );
  const loading = sources.some((s) => s.loading);
  const fetching = sources.some((s) => s.fetching) || ratings.fetching;

  // The same problem (a missing permission, say) often hits several games at once.
  const problems = new Map<string, { store: ReviewStore; message: string; apps: string[] }>();
  for (const s of sources) {
    const message = s.data?.problem ?? s.error?.message;
    if (!message) continue;
    const key = `${s.store}\n${message}`;
    const seen = problems.get(key);
    if (seen) seen.apps.push(s.app.name);
    else problems.set(key, { store: s.store, message, apps: [s.app.name] });
  }

  if (!sources.length) {
    return (
      <Notice tone="warn" title="No store IDs yet.">
        Reviews are read from the stores by the game's App Store bundle ID, Google Play package name
        or Steam App ID. Add them in each game's General tab.
      </Notice>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Ratings</h3>
        <RefreshButton
          fetching={fetching}
          onClick={() => {
            sources.forEach((s) => s.refetch());
            ratings.refetch();
          }}
        />
      </div>

      {many ? (
        <RatingsTable
          apps={apps}
          sources={sources}
          ratings={ratings}
          selected={appFilter}
          onSelect={filter(onAppFilterChange)}
        />
      ) : (
        <ScoreCards sources={sources} ratings={ratings} />
      )}

      {[...problems].map(([key, p]) => (
        <Notice
          key={key}
          tone="warn"
          title={`${REVIEW_STORE_LABELS[p.store]}${many ? ` · ${p.apps.join(", ")}` : ""}`}
        >
          {p.message}
        </Notice>
      ))}
      {!ratings.loading && ratings.missed > 0 && (
        <Notice title="Some App Store ratings are missing.">
          Apple didn't answer for {plural(ratings.missed, "country", "countries")}, so the App Store
          totals may be a little low. Refresh to ask again.
        </Notice>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <h3 className="font-semibold mr-auto">
            Reviews
            {!loading && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {visible.length === all.length ? all.length : `${visible.length} of ${all.length}`}
              </span>
            )}
          </h3>
          {many && (
            <Select value={appFilter} onValueChange={filter(onAppFilterChange)}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All games</SelectItem>
                {apps.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {stores.length > 1 && (
            <Select
              value={storeFilter}
              onValueChange={filter((v: string) => setStoreFilter(v as ReviewStore | "all"))}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s} value={s}>
                    {REVIEW_STORE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={sentiment}
            onValueChange={filter((v: string) => setSentiment(v as Sentiment | "all"))}
          >
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ratings</SelectItem>
              {(Object.keys(SENTIMENT_LABELS) as Sentiment[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SENTIMENT_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 h-9">
            <Switch
              id="reviews-waiting"
              checked={waitingOnly}
              onCheckedChange={filter(setWaitingOnly)}
            />
            <Label htmlFor="reviews-waiting" className="text-sm font-normal">
              Not replied yet
            </Label>
          </div>
        </div>

        {loading && !all.length ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the reviews from the stores…
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {all.length ? "No reviews match these filters." : "No reviews yet."}
          </p>
        ) : (
          <>
            {visible.slice(0, shown).map(({ review, app }) => (
              <ReviewCard
                key={`${review.store}-${app.id}-${review.id}`}
                review={review}
                app={app}
                showApp={many}
              />
            ))}
            {visible.length > shown && (
              <div className="text-center">
                <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, visible.length - shown)} more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Scores                                                                                */
/* ------------------------------------------------------------------------------------ */

type Score = {
  loading: boolean;
  /** The store has no app with this game's ID. */
  absent: boolean;
  /** "4.3" (stars) or "87%" (Steam); null with nothing to show yet. */
  value: string | null;
  kind: "stars" | "percent";
  lines: string[];
  waiting: number;
  storeUrl?: string | null;
  /** The store couldn't be read, and nothing came back: the notice below says why. */
  unread: boolean;
};

function scoreOf(source: Source, ratings: ReturnType<typeof useAppStoreRatings>): Score {
  const data = source.data;
  const reviews = data?.reviews ?? [];
  const base = {
    loading: source.loading,
    absent: !!data && !data.found,
    waiting: reviews.filter(awaitsReply).length,
    storeUrl: data?.storeUrl,
    unread: !reviews.length && !!(data?.problem || source.error),
  };

  if (source.store === "app_store") {
    const sum = source.app.ids.ios ? ratings.byBundle.get(source.app.ids.ios) : undefined;
    const written = plural(reviews.length, "written review");
    if (sum?.count) {
      const top = sum.countries.slice(0, 3).map((c) => `${c.country} ${c.count}`);
      return {
        ...base,
        loading: base.loading || ratings.loading,
        kind: "stars",
        value: fmtStars(sum.average!),
        lines: [
          plural(sum.count, "rating"),
          written,
          ...(sum.countries.length > 1
            ? [top.join(" · ")]
            : [`All in ${sum.countries[0].country}`]),
        ],
      };
    }
    // Apple's lookup found no ratings (it can miss a country): the written ones still count.
    const average = averageStars(reviews);
    return {
      ...base,
      loading: base.loading || ratings.loading,
      kind: "stars",
      value: average != null ? fmtStars(average) : null,
      lines: [average != null ? `Average of ${written}` : "No ratings yet"],
    };
  }
  if (source.store === "google_play") {
    const average = averageStars(reviews);
    return {
      ...base,
      kind: "stars",
      value: average != null ? fmtStars(average) : null,
      lines: [
        reviews.length ? `Average of ${plural(reviews.length, "review")}` : "No reviews yet",
        ...(data?.storeRatings ? [`${plural(data.storeRatings, "rating")} on the store page`] : []),
      ],
    };
  }
  const verdict = data?.steam;
  const positive = verdict?.positive ?? reviews.filter((r) => r.recommended).length;
  const total = verdict ? verdict.positive + verdict.negative : reviews.length;
  return {
    ...base,
    kind: "percent",
    value: total ? `${Math.round((positive / total) * 100)}%` : null,
    lines: [
      total ? `positive of ${plural(total, "review")}` : "No reviews yet",
      // Steam's word for the score, unless it only counts ("5 user reviews").
      ...(verdict?.label && !/review/i.test(verdict.label)
        ? [`Steam rates it ${verdict.label}`]
        : []),
    ],
  };
}

function ScoreValue({ score, large }: { score: Score; large?: boolean }) {
  if (score.loading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (!score.value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold",
        large && "text-3xl tracking-tight",
      )}
    >
      {score.value}
      {score.kind === "stars" ? (
        <Star className={cn("fill-amber-400 text-amber-400", large ? "h-6 w-6" : "h-3.5 w-3.5")} />
      ) : (
        <ThumbsUp className={cn("text-emerald-500", large ? "h-6 w-6" : "h-3.5 w-3.5")} />
      )}
    </span>
  );
}

/** One card per store, for when only one game is on the stores. */
function ScoreCards({
  sources,
  ratings,
}: {
  sources: Source[];
  ratings: ReturnType<typeof useAppStoreRatings>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {sources.map((source) => {
        const score = scoreOf(source, ratings);
        return (
          <Card key={source.store}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground label-mono">
                  {REVIEW_STORE_LABELS[source.store]}
                </span>
                {score.storeUrl && (
                  <a
                    href={score.storeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    title="Open the store page"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              {score.absent ? (
                <p className="text-sm text-muted-foreground">Not on this store.</p>
              ) : score.unread && !score.loading ? (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  Couldn't read it. See below.
                </p>
              ) : (
                <>
                  <ScoreValue score={score} large />
                  {!score.loading && (
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {score.lines.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      {score.waiting > 0 && (
                        <p className="text-amber-600 dark:text-amber-400">
                          {plural(score.waiting, "review")} not replied yet
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** One row per game: the Reviews page. A row filters the reviews below to that game. */
function RatingsTable({
  apps,
  sources,
  ratings,
  selected,
  onSelect,
}: {
  apps: ReviewsApp[];
  sources: Source[];
  ratings: ReturnType<typeof useAppStoreRatings>;
  selected: string;
  onSelect: (appId: string) => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Game</TableHead>
              {REVIEW_STORES.map((s) => (
                <TableHead key={s}>{REVIEW_STORE_LABELS[s]}</TableHead>
              ))}
              <TableHead className="text-right">Not replied</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apps.map((app) => {
              const scores = REVIEW_STORES.map((store) => {
                const source = sources.find((s) => s.app.id === app.id && s.store === store);
                return source ? scoreOf(source, ratings) : null;
              });
              const waiting = scores.reduce((n, s) => n + (s?.waiting ?? 0), 0);
              return (
                <TableRow
                  key={app.id}
                  onClick={() => onSelect(selected === app.id ? "all" : app.id)}
                  className={cn("cursor-pointer", selected === app.id && "bg-muted/60")}
                  title={
                    selected === app.id
                      ? "Show every game's reviews"
                      : "Show only this game's reviews"
                  }
                >
                  <TableCell className="text-sm font-medium">{app.name}</TableCell>
                  {scores.map((score, i) => (
                    <TableCell key={REVIEW_STORES[i]} className="text-sm align-top">
                      {!score || score.absent ? (
                        <span className="text-muted-foreground">—</span>
                      ) : score.unread && !score.loading ? (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                          Couldn't read it
                        </span>
                      ) : (
                        <div>
                          <ScoreValue score={score} />
                          {!score.loading && (
                            <div className="text-[11px] text-muted-foreground">
                              {score.lines[0]}
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right text-sm">
                    {waiting ? (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        {waiting}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Reviews                                                                               */
/* ------------------------------------------------------------------------------------ */

function Stars({ stars }: { stars: number }) {
  return (
    <span
      className="inline-flex"
      aria-label={`${stars} out of 5 stars`}
      title={`${stars} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-4 w-4",
            n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

// Longer reviews start folded, so one essay doesn't push the rest off the screen.
const FOLD_AT = 600;

function ReviewCard({
  review,
  app,
  showApp,
}: {
  review: StoreReview;
  app: ReviewsApp;
  showApp: boolean;
}) {
  const [open, setOpen] = useState(false);
  const folded = !open && review.text.length > FOLD_AT;
  const meta = [
    review.author,
    review.country,
    review.language,
    review.version && `v${review.version}`,
    review.device,
    review.hoursPlayed != null && `${review.hoursPlayed} h played`,
    `${fmtDate(review.date)}${review.edited ? " (edited)" : ""}`,
  ].filter(Boolean);
  const text = [review.title, review.text].filter(Boolean).join("\n\n");

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {review.stars != null ? (
            <Stars stars={review.stars} />
          ) : review.recommended ? (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
              <ThumbsUp className="h-4 w-4" /> Recommended
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm text-destructive">
              <ThumbsDown className="h-4 w-4" /> Not recommended
            </span>
          )}
          {review.title && <span className="font-medium text-sm">{review.title}</span>}
          <span className="ml-auto flex items-center gap-2">
            {showApp && <span className="text-xs text-muted-foreground">{app.name}</span>}
            <Badge variant="outline" className="text-xs whitespace-nowrap">
              {REVIEW_STORE_LABELS[review.store]}
            </Badge>
          </span>
        </div>

        {review.text && (
          <div className="text-sm whitespace-pre-wrap break-words">
            {folded ? `${review.text.slice(0, FOLD_AT).trimEnd()}…` : review.text}
            {review.text.length > FOLD_AT && (
              <button
                onClick={() => setOpen(!open)}
                className="ml-1 text-xs text-muted-foreground hover:text-foreground underline"
              >
                {open ? "Show less" : "Read all"}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{meta.join(" · ")}</span>
          <span className="ml-auto flex items-center gap-3">
            {text && (
              <a
                href={translateUrl(text)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Languages className="h-3 w-3" /> Translate
              </a>
            )}
            {review.url && (
              <a
                href={review.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                {review.store === "steam" ? "Steam" : "Play Console"}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </span>
        </div>

        <ReplyBox review={review} appId={app.id} />
      </CardContent>
    </Card>
  );
}

function ReplyBox({ review, appId }: { review: StoreReview; appId: string }) {
  const qc = useQueryClient();
  const replyFn = useServerFn(replyToReview);
  const deleteFn = useServerFn(deleteReviewReply);
  const [draft, setDraft] = useState<string | null>(null);
  const store = review.store;
  const replyable = review.canReply && canReplyFromConsole(store);

  // The stores take a while to show a reply in their lists (Google Play's exports, a
  // day), so the answer goes straight into the cached list instead of reading it again.
  const setReply = (reply: ReviewReply | null) =>
    qc.setQueryData<StoreReviews>(
      reviewsKey(store, appId),
      (old) =>
        old && {
          ...old,
          reviews: old.reviews.map((r) => (r.id === review.id ? { ...r, reply } : r)),
        },
    );

  const sendM = useMutation({
    mutationFn: (text: string) => {
      if (!canReplyFromConsole(store)) throw new Error("Steam replies are written on Steam.");
      return replyFn({ data: { appId, store, reviewId: review.id, text } });
    },
    onSuccess: (reply) => {
      setReply(reply);
      setDraft(null);
      toast.success(
        store === "app_store"
          ? "Reply sent. Apple shows it on the App Store once it has checked it, usually within a day."
          : "Reply sent. It's on Google Play now.",
        { duration: 8000 },
      );
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  const deleteM = useMutation({
    mutationFn: (replyId: string) => deleteFn({ data: { replyId } }),
    onSuccess: () => {
      setReply(null);
      toast.success("Reply deleted.");
    },
    onError: (e: Error) => toast.error(e.message, { duration: 15000 }),
  });

  if (draft != null && replyable && canReplyFromConsole(store)) {
    const limit = REPLY_LIMITS[store];
    const tooLong = charCount(draft) > limit;
    return (
      <div className="space-y-2 pt-1">
        <LimitedField
          id={`reply-${review.store}-${review.id}`}
          label={review.reply ? "Edit your reply" : "Your reply"}
          hint={REPLY_HINTS[store]}
          value={draft}
          limit={limit}
          multiline
          rows={4}
          onChange={setDraft}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={sendM.isPending || !draft.trim() || tooLong}
            onClick={() => sendM.mutate(draft.trim())}
          >
            {sendM.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Send reply
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={sendM.isPending}
            onClick={() => setDraft(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (review.reply) {
    const reply = review.reply;
    return (
      <div className="rounded-md border-l-2 border-primary/50 bg-muted/40 px-3 py-2 space-y-1">
        <p className="text-xs text-muted-foreground">
          Your reply{reply.date && ` · ${fmtDate(reply.date)}`}
          {reply.pending && (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              · waiting for Apple to show it
            </span>
          )}
        </p>
        <p className="text-sm whitespace-pre-wrap break-words">{reply.text}</p>
        {replyable && (
          <div className="flex gap-3 pt-1">
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => setDraft(reply.text)}
            >
              Edit
            </button>
            {store === "app_store" && reply.id && (
              <button
                className="text-xs text-muted-foreground hover:text-destructive underline disabled:opacity-50"
                disabled={deleteM.isPending}
                onClick={() => {
                  if (confirm("Delete this reply from the App Store?")) deleteM.mutate(reply.id!);
                }}
              >
                {deleteM.isPending ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (replyable) {
    return (
      <Button size="sm" variant="outline" onClick={() => setDraft("")}>
        Reply
      </Button>
    );
  }
  // Steam has no way for other tools to reply; the developer does it on the review's page.
  return store === "steam" && review.url ? (
    <Button asChild size="sm" variant="outline" className="gap-1.5">
      <a href={review.url} target="_blank" rel="noreferrer">
        Reply on Steam <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </Button>
  ) : null;
}
