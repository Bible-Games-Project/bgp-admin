import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSteamListing, type SteamListing } from "@/lib/steam-listing.functions";
import { LimitedField, Notice, RefreshButton } from "@/components/StoreListingParts";

// Steam refuses a short description longer than this when the page is saved.
const SHORT_DESCRIPTION_LIMIT = 300;

export function SteamListingPanel({ appId }: { appId: string }) {
  const getFn = useServerFn(getSteamListing);
  const [language, setLanguage] = useState("english");

  const q = useQuery({
    queryKey: ["store-listing", "steam", appId, language],
    queryFn: () => getFn({ data: { appId, language } }),
    refetchOnWindowFocus: false,
    // Switching language keeps the page on screen instead of flashing "Reading…".
    placeholderData: keepPreviousData,
  });

  if (q.isLoading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the Steam store page…
      </p>
    );
  }
  if (q.error) return <Notice tone="error" title={(q.error as Error).message} />;
  const page = q.data!;
  if (page.error) {
    return (
      <Notice tone="error" title="Couldn't read the Steam store page.">
        <p>{page.error}</p>
        <RefreshButton fetching={q.isFetching} onClick={() => q.refetch()} className="mt-2" />
      </Notice>
    );
  }

  const outdated = (page.capsules ?? []).filter((c) => c.outdated);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{page.name}</span>
          <span className="font-mono"> · App ID {page.appId}</span>
        </p>
        <div className="flex items-center gap-3">
          <RefreshButton fetching={q.isFetching} onClick={() => q.refetch()} />
          <a
            href={page.storeUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            View on Steam <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <Notice title="Steam pages are edited on Steamworks.">
        <p>
          Steam has no way for other tools to change a store page, so this view only shows what is
          published. To change the texts, images or trailers, open the page on Steamworks, make the
          change there and press Publish.
        </p>
        <Button asChild size="sm" variant="outline" className="mt-2 gap-1.5">
          <a href={page.steamworksUrl} target="_blank" rel="noreferrer">
            Edit the store page on Steamworks <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      </Notice>

      <Summary page={page} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Description</h3>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(page.languages ?? []).map((l) => (
                <SelectItem key={l.api} value={l.api}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {page.translated === false && (
          <Notice tone="warn" title="This language has no description of its own.">
            Steam shows the English text to players who use it. Add a translation on Steamworks →
            Edit Store Page → Description.
          </Notice>
        )}
        <LimitedField
          id="steam-short-description"
          label="Short description"
          hint="The text under the header image, next to the screenshots."
          value={page.shortDescription ?? ""}
          limit={SHORT_DESCRIPTION_LIMIT}
          readOnly
          multiline
          rows={3}
          onChange={() => {}}
        />
        <div className="space-y-1.5">
          <p className="text-sm font-medium">About this game</p>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap max-h-80 overflow-y-auto">
            {page.fullDescription || <span className="text-muted-foreground">Empty.</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Shown as plain text here; the formatting and images are on the store page.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Store images</h3>
        {outdated.length > 0 && (
          <Notice tone="warn" title={`${outdated.length} of these images are still at the old size.`}>
            In 2024 Steam doubled the size of its store images and it no longer accepts the old
            size. To replace{" "}
            {outdated.length === 1 ? "this one" : "these"}, upload each at the size shown under it,
            on Steamworks → Edit Store Page → Graphical Assets.
          </Notice>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(page.capsules ?? []).map((c) => (
            <figure key={c.label} className="space-y-1">
              <div className="aspect-video rounded-md border border-border bg-muted/40 overflow-hidden flex items-center justify-center">
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer" className="h-full w-full">
                    <img src={c.url} alt={c.label} loading="lazy" className="h-full w-full object-contain" />
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Not uploaded</span>
                )}
              </div>
              <figcaption className="text-xs">
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground"> · {c.size}</span>
                {c.outdated && (
                  <span className="block text-amber-600 dark:text-amber-400">old size</span>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">
          Screenshots <span className="text-muted-foreground font-normal">({page.screenshots?.length ?? 0})</span>
        </h3>
        {(page.screenshots?.length ?? 0) < 5 && (
          <Notice tone="warn" title="Steam asks for at least 5 screenshots.">
            Upload them on Steamworks → Edit Store Page → Screenshots, at 1920 × 1080 or larger.
          </Notice>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(page.screenshots ?? []).map((s) => (
            <a key={s.full} href={s.full} target="_blank" rel="noreferrer">
              <img
                src={s.thumb}
                alt="Screenshot"
                loading="lazy"
                className="aspect-video w-full rounded-md border border-border object-cover"
              />
            </a>
          ))}
        </div>
        {(page.trailers?.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            Trailers: {page.trailers!.join(", ")}. Watch them on the store page.
          </p>
        )}
      </section>
    </div>
  );
}

function Summary({ page }: { page: SteamListing }) {
  const released = page.comingSoon
    ? "Coming soon"
    : page.releaseDate
      ? new Date(page.releaseDate).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "—";
  const reviews = page.reviews?.count
    ? `${page.reviews.count} · ${page.reviews.percentPositive}% positive`
    : "None yet";
  const rows: [string, string][] = [
    ["Release", released],
    ["Price (Spain)", page.price ?? (page.comingSoon ? "Not on sale yet" : "—")],
    ["Platforms", page.platforms?.length ? page.platforms.join(", ") : "—"],
    ["Reviews", reviews],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
      {(page.languages?.length ?? 0) > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left font-medium p-2">Language</th>
                <th className="font-medium p-2">Interface</th>
                <th className="font-medium p-2">Full audio</th>
                <th className="font-medium p-2">Subtitles</th>
              </tr>
            </thead>
            <tbody>
              {page.languages!.map((l) => (
                <tr key={l.api} className="border-t border-border">
                  <td className="p-2">{l.label}</td>
                  <td className="p-2 text-center">{l.interface ? "✓" : ""}</td>
                  <td className="p-2 text-center">{l.audio ? "✓" : ""}</td>
                  <td className="p-2 text-center">{l.subtitles ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
