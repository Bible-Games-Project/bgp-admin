import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  EDITABLE_STATES,
  IN_FLIGHT_STATES,
  LIVE_STATES,
  createAscApi,
  findAscApp,
  versionStateOf,
  type AscApi,
} from "./asc.server";
import {
  PlayError,
  commitEdit,
  createPlayApi,
  openEdit,
  withEdit,
  type PlayApi,
} from "./google-play.server";
import {
  ASC_INFO_FIELDS,
  ASC_MAX_SCREENSHOTS,
  ASC_UPLOAD_SLOTS,
  ASC_LIMITS,
  ASC_LOCALES,
  ASC_TEXT_FIELDS,
  PLAY_DETAIL_FIELDS,
  PLAY_IMAGE_RULES,
  PLAY_IMAGE_TYPES,
  PLAY_LANGUAGES,
  PLAY_LIMITS,
  PLAY_TEXT_FIELDS,
  ascDisplayTypeLabel,
  ascDisplayTypeRank,
  ascThumbnailUrl,
  charCount,
  localeLabel,
  nextVersionString,
  type AscFields,
  type AscTextField,
  type PlayDetails,
  type PlayFields,
  type ScreenshotGroup,
  type StoreImage,
} from "./store-listing";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not an admin");
}

async function loadBundleId(supabase: any, appId: string): Promise<string> {
  const { data, error } = await supabase
    .from("apps")
    .select("bundle_id")
    .eq("id", appId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("App not found");
  if (!data.bundle_id) throw new Error(NO_BUNDLE_ID);
  return data.bundle_id;
}

const NO_BUNDLE_ID = "This app has no bundle ID yet. Set it in the General tab first.";

const localeCode = z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/, "Not a language code");

function limitedFields<F extends string>(fields: readonly F[], limits: Record<F, number>) {
  return z
    .object(
      Object.fromEntries(
        fields.map((f) => [
          f,
          z
            .string()
            .refine((v) => charCount(v) <= limits[f], `Longer than ${limits[f]} characters`),
        ]),
      ) as Record<F, z.ZodEffects<z.ZodString>>,
    )
    .partial();
}

/* ------------------------------------------------------------------------------------ */
/* App Store                                                                             */
/* ------------------------------------------------------------------------------------ */

// App info states. The live listing's info is READY_FOR_DISTRIBUTION (READY_FOR_SALE in
// the older `appStoreState`); the one being prepared follows its version's state.
const APP_INFO_LIVE_STATES = ["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"];
const APP_INFO_EDITABLE_STATES = [...EDITABLE_STATES, "READY_FOR_REVIEW"];
const APP_INFO_RETIRED_STATES = ["REPLACED_WITH_NEW_INFO"];

type AscRef = { id: string; versionString: string; state: string };
type AscInfoRef = { id: string; state: string };

async function loadAscContext(api: AscApi, bundleId: string) {
  const ascApp = await findAscApp(api, bundleId);
  if (!ascApp) return null;
  const [versionsRes, infosRes] = await Promise.all([
    api.get(`/v1/apps/${ascApp.id}/appStoreVersions?filter[platform]=IOS&limit=50`),
    api.get(`/v1/apps/${ascApp.id}/appInfos?limit=10`),
  ]);
  const versions: AscRef[] = (versionsRes.data ?? []).map((v: any) => ({
    id: v.id,
    versionString: v.attributes.versionString,
    state: versionStateOf(v),
  }));
  const infos: AscInfoRef[] = (infosRes.data ?? [])
    .map((i: any) => ({
      id: i.id,
      state: i.attributes?.state ?? i.attributes?.appStoreState ?? "UNKNOWN",
    }))
    .filter((i: AscInfoRef) => !APP_INFO_RETIRED_STATES.includes(i.state));
  const nextInfo = infos.find((i) => !APP_INFO_LIVE_STATES.includes(i.state)) ?? null;
  return {
    ascAppId: ascApp.id as string,
    primaryLocale: (ascApp.attributes?.primaryLocale as string | undefined) ?? "en-US",
    live: versions.find((v) => LIVE_STATES.includes(v.state)) ?? null,
    editable: versions.find((v) => EDITABLE_STATES.includes(v.state)) ?? null,
    inFlight: versions.find((v) => IN_FLIGHT_STATES.includes(v.state)) ?? null,
    liveInfo: infos.find((i) => APP_INFO_LIVE_STATES.includes(i.state)) ?? null,
    nextInfo,
    nextInfoEditable: !!nextInfo && APP_INFO_EDITABLE_STATES.includes(nextInfo.state),
  };
}

type AscContext = NonNullable<Awaited<ReturnType<typeof loadAscContext>>>;

async function requireAscApi() {
  const api = await createAscApi();
  if (!api) throw new Error("App Store Connect credentials are not configured on this console.");
  return api;
}

async function listInfoLocalizations(api: AscApi, info: AscInfoRef | null): Promise<any[]> {
  if (!info) return [];
  return (await api.get(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`)).data ?? [];
}

async function listVersionLocalizations(api: AscApi, version: AscRef | null): Promise<any[]> {
  if (!version) return [];
  return (
    (await api.get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`))
      .data ?? []
  );
}

export type AscLocale = {
  locale: string;
  fields: AscFields;
};

export type AscView = {
  kind: "live" | "next";
  versionString: string;
  state: string;
  /** Description, keywords and URLs can be edited. */
  versionEditable: boolean;
  /** Name, subtitle and privacy policy URL can be edited. */
  infoEditable: boolean;
  /** Promotional text can be edited — the one field that changes without a new version. */
  promoEditable: boolean;
  locales: AscLocale[];
};

export type AppStoreListing = {
  /** False when the Worker has no App Store Connect credentials configured. */
  available: boolean;
  error?: string;
  /** The app does not exist in App Store Connect yet. */
  notFound?: boolean;
  ascAppId?: string;
  primaryLocale?: string;
  /** Live first, then the version being prepared or reviewed. */
  views?: AscView[];
  /** Set when no version is open or in review: the number a new one would get. */
  canPrepare?: string | null;
};

async function readLocales(
  api: AscApi,
  info: AscInfoRef | null,
  version: AscRef,
): Promise<AscLocale[]> {
  const [infoLocs, versionLocs] = await Promise.all([
    listInfoLocalizations(api, info),
    listVersionLocalizations(api, version),
  ]);
  const byLocale = new Map<string, AscFields>();
  const empty = (): AscFields =>
    Object.fromEntries(ASC_TEXT_FIELDS.map((f) => [f, ""])) as AscFields;
  for (const loc of [...infoLocs, ...versionLocs]) {
    const locale = loc.attributes.locale as string;
    const fields = byLocale.get(locale) ?? empty();
    for (const f of ASC_TEXT_FIELDS) {
      const value = loc.attributes[f];
      if (typeof value === "string") fields[f] = value;
    }
    byLocale.set(locale, fields);
  }
  return [...byLocale.entries()].map(([locale, fields]) => ({ locale, fields }));
}

export const getAppStoreListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<AppStoreListing> => {
    await assertAdmin(context.supabase, context.userId);
    const api = await createAscApi();
    if (!api) return { available: false };

    try {
      const bundleId = await loadBundleId(context.supabase, data.appId);
      const ctx = await loadAscContext(api, bundleId);
      if (!ctx) {
        return {
          available: true,
          notFound: true,
          error: `No app in App Store Connect has the bundle ID ${bundleId} yet.`,
        };
      }

      const next = ctx.editable ?? ctx.inFlight;
      const [liveLocales, nextLocales] = await Promise.all([
        ctx.live ? readLocales(api, ctx.liveInfo ?? ctx.nextInfo, ctx.live) : null,
        next ? readLocales(api, ctx.nextInfo ?? ctx.liveInfo, next) : null,
      ]);

      const views: AscView[] = [];
      if (ctx.live && liveLocales) {
        views.push({
          kind: "live",
          versionString: ctx.live.versionString,
          state: ctx.live.state,
          versionEditable: false,
          infoEditable: false,
          promoEditable: true,
          locales: liveLocales,
        });
      }
      if (next && nextLocales) {
        const open = next === ctx.editable;
        views.push({
          kind: "next",
          versionString: next.versionString,
          state: next.state,
          versionEditable: open,
          infoEditable: open && ctx.nextInfoEditable,
          promoEditable: open,
          locales: nextLocales,
        });
      }

      return {
        available: true,
        ascAppId: ctx.ascAppId,
        primaryLocale: ctx.primaryLocale,
        views,
        canPrepare: next ? null : nextVersionString(ctx.live?.versionString),
      };
    } catch (err: any) {
      return { available: true, error: err?.message ?? "Could not reach App Store Connect." };
    }
  });

function versionForView(ctx: AscContext, view: "live" | "next"): AscRef {
  if (view === "live") {
    if (!ctx.live) throw new Error("This app has no version on the App Store yet.");
    return ctx.live;
  }
  if (!ctx.editable) {
    throw new Error(
      ctx.inFlight
        ? `Apple is reviewing version ${ctx.inFlight.versionString}; it can't be changed until the review ends.`
        : "No version is open for editing. Use Prepare next version first.",
    );
  }
  return ctx.editable;
}

// Apple treats an empty string as a value; null clears the field.
function toAscAttributes(fields: Partial<AscFields>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v && v.trim() ? v : null]));
}

export const saveAppStoreLocale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        view: z.enum(["live", "next"]),
        locale: localeCode,
        fields: limitedFields(ASC_TEXT_FIELDS, ASC_LIMITS),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const bundleId = await loadBundleId(context.supabase, data.appId);
    const api = await requireAscApi();
    const ctx = await loadAscContext(api, bundleId);
    if (!ctx) throw new Error(`No app in App Store Connect has the bundle ID ${bundleId}.`);

    const fields = data.fields as Partial<AscFields>;
    const keys = Object.keys(fields) as AscTextField[];
    if (keys.length === 0) return { message: "Nothing to save." };
    if (data.view === "live" && keys.some((k) => k !== "promotionalText")) {
      throw new Error(
        "Only the promotional text can change on the live version. Edit the rest under Next version.",
      );
    }
    if ("name" in fields && !fields.name?.trim()) throw new Error("The name can't be empty.");

    const version = versionForView(ctx, data.view);
    const infoFields = Object.fromEntries(
      keys.filter((k) => ASC_INFO_FIELDS.includes(k)).map((k) => [k, fields[k]]),
    ) as Partial<AscFields>;
    const versionFields = Object.fromEntries(
      keys.filter((k) => !ASC_INFO_FIELDS.includes(k)).map((k) => [k, fields[k]]),
    ) as Partial<AscFields>;

    if (Object.keys(infoFields).length) {
      if (!ctx.nextInfoEditable || !ctx.nextInfo) {
        throw new Error("The name, subtitle and privacy policy can't be changed right now.");
      }
      const loc = (await listInfoLocalizations(api, ctx.nextInfo)).find(
        (l) => l.attributes.locale === data.locale,
      );
      if (!loc) throw new Error(`${localeLabel(data.locale)} is not on this version.`);
      await api.patch(`/v1/appInfoLocalizations/${loc.id}`, {
        data: { type: "appInfoLocalizations", id: loc.id, attributes: toAscAttributes(infoFields) },
      });
    }

    if (Object.keys(versionFields).length) {
      const loc = (await listVersionLocalizations(api, version)).find(
        (l) => l.attributes.locale === data.locale,
      );
      if (!loc) throw new Error(`${localeLabel(data.locale)} is not on this version.`);
      await api.patch(`/v1/appStoreVersionLocalizations/${loc.id}`, {
        data: {
          type: "appStoreVersionLocalizations",
          id: loc.id,
          attributes: toAscAttributes(versionFields),
        },
      });
    }

    return {
      message:
        data.view === "live"
          ? "Promotional text saved. It shows on the App Store within a few minutes."
          : `Saved to version ${version.versionString}. It goes live when that version is released.`,
    };
  });

export const prepareNextAppStoreVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const bundleId = await loadBundleId(context.supabase, data.appId);
    const api = await requireAscApi();
    const ctx = await loadAscContext(api, bundleId);
    if (!ctx) throw new Error(`No app in App Store Connect has the bundle ID ${bundleId}.`);
    if (ctx.editable) {
      return { message: `Version ${ctx.editable.versionString} is already open for editing.` };
    }
    if (ctx.inFlight) {
      throw new Error(
        `Apple is reviewing version ${ctx.inFlight.versionString}. A new version can be prepared once that review ends.`,
      );
    }

    const versionString = nextVersionString(ctx.live?.versionString);
    const created = await api.post("/v1/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        // Same release type deploy-ios.yml sets: live as soon as Apple approves it.
        attributes: { platform: "IOS", versionString, releaseType: "AFTER_APPROVAL" },
        relationships: { app: { data: { type: "apps", id: ctx.ascAppId } } },
      },
    });

    // App Store Connect normally starts a new version as a copy of the live one. Make
    // sure of it for the texts: any language the live version has and the new one
    // lacks, or has empty, gets the live texts.
    if (ctx.live) {
      const newVersion: AscRef = { id: created.data.id, versionString, state: "" };
      const [liveLocs, newLocs] = await Promise.all([
        listVersionLocalizations(api, ctx.live),
        listVersionLocalizations(api, newVersion),
      ]);
      const copyable = ["description", "keywords", "promotionalText", "supportUrl", "marketingUrl"];
      for (const liveLoc of liveLocs) {
        const attributes = Object.fromEntries(
          copyable
            .map((f) => [f, liveLoc.attributes[f]])
            .filter(([, v]) => typeof v === "string" && v.trim()),
        );
        const existing = newLocs.find((l) => l.attributes.locale === liveLoc.attributes.locale);
        if (!existing) {
          await api.post("/v1/appStoreVersionLocalizations", {
            data: {
              type: "appStoreVersionLocalizations",
              attributes: { locale: liveLoc.attributes.locale, ...attributes },
              relationships: {
                appStoreVersion: { data: { type: "appStoreVersions", id: newVersion.id } },
              },
            },
          });
        } else if (!existing.attributes.description?.trim()) {
          await api.patch(`/v1/appStoreVersionLocalizations/${existing.id}`, {
            data: { type: "appStoreVersionLocalizations", id: existing.id, attributes },
          });
        }
      }
    }

    return {
      message: `Version ${versionString} is open for editing. Its number is replaced by the real one at the next Release to Production.`,
    };
  });

export const addAppStoreLocale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), locale: z.enum(ASC_LOCALES) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const bundleId = await loadBundleId(context.supabase, data.appId);
    const api = await requireAscApi();
    const ctx = await loadAscContext(api, bundleId);
    if (!ctx) throw new Error(`No app in App Store Connect has the bundle ID ${bundleId}.`);
    const version = versionForView(ctx, "next");
    if (!ctx.nextInfo || !ctx.nextInfoEditable) {
      throw new Error("Languages can't be added to this version right now.");
    }

    const [infoLocs, versionLocs] = await Promise.all([
      listInfoLocalizations(api, ctx.nextInfo),
      listVersionLocalizations(api, version),
    ]);
    // Start the new language as a copy of the primary one, so the version never has a
    // language missing a required field when it is submitted.
    const primaryInfo = infoLocs.find((l) => l.attributes.locale === ctx.primaryLocale);
    const primaryVersion = versionLocs.find((l) => l.attributes.locale === ctx.primaryLocale);
    const pick = (source: any, fields: readonly string[]) =>
      Object.fromEntries(
        fields
          .map((f) => [f, source?.attributes?.[f]])
          .filter(([, v]) => typeof v === "string" && v.trim()),
      );

    if (!infoLocs.some((l) => l.attributes.locale === data.locale)) {
      await api.post("/v1/appInfoLocalizations", {
        data: {
          type: "appInfoLocalizations",
          attributes: {
            locale: data.locale,
            ...pick(primaryInfo, ["name", "subtitle", "privacyPolicyUrl"]),
          },
          relationships: { appInfo: { data: { type: "appInfos", id: ctx.nextInfo.id } } },
        },
      });
    }
    if (!versionLocs.some((l) => l.attributes.locale === data.locale)) {
      await api.post("/v1/appStoreVersionLocalizations", {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: {
            locale: data.locale,
            ...pick(primaryVersion, [
              "description",
              "keywords",
              "promotionalText",
              "supportUrl",
              "marketingUrl",
            ]),
          },
          relationships: {
            appStoreVersion: { data: { type: "appStoreVersions", id: version.id } },
          },
        },
      });
    }
    return {
      message: `${localeLabel(data.locale)} added with the ${localeLabel(ctx.primaryLocale)} text copied in. Translate it before the next release.`,
    };
  });

export const removeAppStoreLocale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), locale: localeCode }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const bundleId = await loadBundleId(context.supabase, data.appId);
    const api = await requireAscApi();
    const ctx = await loadAscContext(api, bundleId);
    if (!ctx) throw new Error(`No app in App Store Connect has the bundle ID ${bundleId}.`);
    if (data.locale === ctx.primaryLocale) {
      throw new Error("The primary language can't be removed.");
    }
    const version = versionForView(ctx, "next");

    const versionLoc = (await listVersionLocalizations(api, version)).find(
      (l) => l.attributes.locale === data.locale,
    );
    if (versionLoc) await api.delete(`/v1/appStoreVersionLocalizations/${versionLoc.id}`);
    if (ctx.nextInfo && ctx.nextInfoEditable) {
      const infoLoc = (await listInfoLocalizations(api, ctx.nextInfo)).find(
        (l) => l.attributes.locale === data.locale,
      );
      if (infoLoc) await api.delete(`/v1/appInfoLocalizations/${infoLoc.id}`);
    }
    return {
      message: `${localeLabel(data.locale)} removed from version ${version.versionString}. It stays on the App Store until that version is released.`,
    };
  });

type ScreenshotSet = { id: string; type: string; shots: any[] };

async function readScreenshotSets(api: AscApi, localizationId: string): Promise<ScreenshotSet[]> {
  const sets =
    (await api.get(`/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=50`))
      .data ?? [];
  return Promise.all(
    sets.map(async (set: any) => ({
      id: set.id,
      type: set.attributes.screenshotDisplayType as string,
      // Apple returns them in their display order.
      shots: (await api.get(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=10`)).data ?? [],
    })),
  );
}

function toStoreImage(shot: any): StoreImage {
  const delivery = shot.attributes?.assetDeliveryState;
  const failed = delivery?.state === "FAILED";
  const done = delivery?.state === "COMPLETE";
  return {
    id: shot.id,
    url: done || !delivery ? ascThumbnailUrl(shot.attributes?.imageAsset) : null,
    state: failed ? "failed" : done || !delivery ? undefined : "processing",
    error: failed
      ? (delivery.errors ?? []).map((e: any) => e.description ?? e.code).join(" ") ||
        "Apple could not process this image."
      : undefined,
  };
}

export const getAppStoreScreenshots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ appId: z.string().uuid(), view: z.enum(["live", "next"]), locale: localeCode })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ groups: ScreenshotGroup[] }> => {
    await assertAdmin(context.supabase, context.userId);
    const bundleId = await loadBundleId(context.supabase, data.appId);
    const api = await requireAscApi();
    const ctx = await loadAscContext(api, bundleId);
    if (!ctx) return { groups: [] };
    const version = data.view === "live" ? ctx.live : (ctx.editable ?? ctx.inFlight);
    if (!version) return { groups: [] };

    const loc = (await listVersionLocalizations(api, version)).find(
      (l) => l.attributes.locale === data.locale,
    );
    if (!loc) return { groups: [] };
    const sets = await readScreenshotSets(api, loc.id);
    return {
      groups: sets
        .filter((set) => set.shots.length)
        .map((set) => ({
          key: set.type,
          label: ascDisplayTypeLabel(set.type),
          images: set.shots.map(toStoreImage),
        }))
        .sort((a, b) => ascDisplayTypeRank(a.key) - ascDisplayTypeRank(b.key)),
    };
  });

/** The version being prepared and its localization for `locale`; screenshots change only there. */
async function editableLocalization(api: AscApi, ctx: AscContext, locale: string) {
  const version = versionForView(ctx, "next");
  const loc = (await listVersionLocalizations(api, version)).find(
    (l) => l.attributes.locale === locale,
  );
  if (!loc) throw new Error(`${localeLabel(locale)} is not on version ${version.versionString}.`);
  return { version, loc };
}

async function ascContextFor(supabase: any, appId: string) {
  const bundleId = await loadBundleId(supabase, appId);
  const api = await requireAscApi();
  const ctx = await loadAscContext(api, bundleId);
  if (!ctx) throw new Error(`No app in App Store Connect has the bundle ID ${bundleId}.`);
  return { api, ctx };
}

const screenshotSlot = z.enum(ASC_UPLOAD_SLOTS.map((s) => s.type) as [string, ...string[]]);

export const uploadAppStoreScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        locale: localeCode,
        displayType: screenshotSlot,
        fileName: z.string().regex(/^[\w.-]{1,100}\.(png|jpg)$/),
        // About 8 MB of image once decoded.
        dataBase64: z.string().min(1).max(11_500_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { api, ctx } = await ascContextFor(context.supabase, data.appId);
    const { loc } = await editableLocalization(api, ctx, data.locale);

    let set = (await readScreenshotSets(api, loc.id)).find((s) => s.type === data.displayType);
    if (!set) {
      const created = await api.post("/v1/appScreenshotSets", {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: data.displayType },
          relationships: {
            appStoreVersionLocalization: {
              data: { type: "appStoreVersionLocalizations", id: loc.id },
            },
          },
        },
      });
      set = { id: created.data.id, type: data.displayType, shots: [] };
    }
    if (set.shots.length >= ASC_MAX_SCREENSHOTS) {
      throw new Error(
        `${ascDisplayTypeLabel(data.displayType)} already has ${ASC_MAX_SCREENSHOTS} screenshots, Apple's maximum. Remove one first.`,
      );
    }

    const bytes = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0));
    // Apple's upload is three steps: reserve the asset, PUT the bytes to the URLs it
    // hands back, then confirm with the file's MD5 so it can start processing.
    const reserved = await api.post("/v1/appScreenshots", {
      data: {
        type: "appScreenshots",
        attributes: { fileName: data.fileName, fileSize: bytes.length },
        relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } },
      },
    });
    const screenshotId = reserved.data.id as string;
    try {
      for (const op of reserved.data.attributes.uploadOperations ?? []) {
        const res = await fetch(op.url, {
          method: op.method,
          headers: Object.fromEntries((op.requestHeaders ?? []).map((h: any) => [h.name, h.value])),
          body: bytes.subarray(op.offset, op.offset + op.length),
        });
        if (!res.ok) throw new Error(`Apple refused the image upload (${res.status}).`);
      }
      await api.patch(`/v1/appScreenshots/${screenshotId}`, {
        data: {
          type: "appScreenshots",
          id: screenshotId,
          attributes: {
            uploaded: true,
            sourceFileChecksum: createHash("md5").update(bytes).digest("hex"),
          },
        },
      });
    } catch (err) {
      // Don't leave an empty placeholder in the set.
      await api.delete(`/v1/appScreenshots/${screenshotId}`).catch(() => {});
      throw err;
    }
    return { message: "Uploaded. Apple takes a minute to process it." };
  });

/** Finds the set holding `screenshotId` on the version being prepared, or throws. */
async function setHolding(api: AscApi, localizationId: string, screenshotId: string) {
  const set = (await readScreenshotSets(api, localizationId)).find((s) =>
    s.shots.some((shot) => shot.id === screenshotId),
  );
  if (!set) throw new Error("That screenshot is no longer on this version. Refresh the page.");
  return set;
}

export const deleteAppStoreScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ appId: z.string().uuid(), locale: localeCode, screenshotId: z.string().min(1) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { api, ctx } = await ascContextFor(context.supabase, data.appId);
    const { loc } = await editableLocalization(api, ctx, data.locale);
    // Only ever delete a screenshot that belongs to this app's version and language.
    await setHolding(api, loc.id, data.screenshotId);
    await api.delete(`/v1/appScreenshots/${data.screenshotId}`);
    return { message: "Screenshot removed." };
  });

export const moveAppStoreScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        locale: localeCode,
        screenshotId: z.string().min(1),
        direction: z.enum(["earlier", "later"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { api, ctx } = await ascContextFor(context.supabase, data.appId);
    const { loc } = await editableLocalization(api, ctx, data.locale);
    const set = await setHolding(api, loc.id, data.screenshotId);
    const ids = set.shots.map((shot) => shot.id as string);
    const from = ids.indexOf(data.screenshotId);
    const to = data.direction === "earlier" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return { message: "Already there." };
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await api.patch(`/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
      data: ids.map((id) => ({ type: "appScreenshots", id })),
    });
    return { message: "Order saved." };
  });

/* ------------------------------------------------------------------------------------ */
/* Google Play                                                                           */
/* ------------------------------------------------------------------------------------ */

// Turns Google's terse refusals into what to do about them. A refusal while changing an
// edit (rather than opening it) means the store presence permission is what is missing.
function describePlayError(err: unknown, api: PlayApi | null, packageName: string): string {
  if (!(err instanceof PlayError)) return (err as Error)?.message ?? "Could not reach Google Play.";
  const who = api?.serviceAccountEmail ?? "the service account";
  if (err.status === 404) {
    return `Google Play has no app with the package name ${packageName} yet. Create it in Play Console first (Setup → Store Listings).`;
  }
  if (err.status === 401 || err.status === 403) {
    if (err.stage === "change") {
      return `The service account (${who}) can see this app but is not allowed to edit its store listing. In Play Console → Users and permissions → ${who} → Account permissions, tick "Manage store presence" and apply.`;
    }
    return `The service account (${who}) can't see ${packageName} in Play Console. In Play Console → Users and permissions → ${who} → App permissions → Add app, pick ${packageName} and tick the same permissions as the other games.`;
  }
  if (err.status === 409 || /edit.*(deleted|expired|conflict)/i.test(err.message)) {
    return "A release is uploading to Google Play right now, which briefly blocks listing changes. Try again in a few minutes.";
  }
  return `Google Play: ${err.message}`;
}

async function openPlay(supabase: any, appId: string) {
  const packageName = await loadBundleId(supabase, appId);
  const api = await createPlayApi(packageName);
  return { packageName, api };
}

function requirePlay(api: PlayApi | null): PlayApi {
  if (!api) throw new Error("The Google Play service account is not configured on this console.");
  return api;
}

export type PlayListing = {
  /** False when the Worker has no Google Play service account configured. */
  available: boolean;
  error?: string;
  /** The app does not exist in Play Console yet. */
  notFound?: boolean;
  packageName?: string;
  defaultLanguage?: string;
  details?: PlayDetails;
  listings?: { language: string; fields: PlayFields }[];
};

export const getPlayListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PlayListing> => {
    await assertAdmin(context.supabase, context.userId);
    let packageName = "";
    let api: PlayApi | null = null;
    try {
      ({ packageName, api } = await openPlay(context.supabase, data.appId));
      if (!api) return { available: false };
      const play = api;
      const { result } = await withEdit(
        play,
        async (edit) => {
          const [details, listings] = await Promise.all([
            play.call("GET", `${edit}/details`),
            play.call("GET", `${edit}/listings`),
          ]);
          return { details, listings };
        },
        { commit: false },
      );
      return {
        available: true,
        packageName,
        defaultLanguage: result.details.defaultLanguage,
        details: {
          contactEmail: result.details.contactEmail ?? "",
          contactWebsite: result.details.contactWebsite ?? "",
        },
        listings: (result.listings.listings ?? []).map((l: any) => ({
          language: l.language,
          fields: Object.fromEntries(PLAY_TEXT_FIELDS.map((f) => [f, l[f] ?? ""])) as PlayFields,
        })),
      };
    } catch (err) {
      return {
        available: true,
        packageName,
        notFound: err instanceof PlayError && err.status === 404,
        error: describePlayError(err, api, packageName),
      };
    }
  });

export const getPlayImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), language: localeCode }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ groups: ScreenshotGroup[] }> => {
    await assertAdmin(context.supabase, context.userId);
    const { packageName, api } = await openPlay(context.supabase, data.appId);
    const play = requirePlay(api);
    try {
      const { result } = await withEdit(
        play,
        (edit) =>
          Promise.all(
            PLAY_IMAGE_TYPES.map(async ([type, label]) => {
              const res = await play.call("GET", `${edit}/listings/${data.language}/${type}`);
              return {
                key: type,
                label,
                images: (res.images ?? []).map((img: any) => ({ id: img.id, url: img.url })),
              };
            }),
          ),
        { commit: false },
      );
      return { groups: result };
    } catch (err) {
      throw new Error(describePlayError(err, play, packageName));
    }
  });

const REVIEW_NOTE = "Google reviews listing changes before they appear, usually within a day.";
const MANUAL_SEND_NOTE =
  "Google did not send it for review on its own: open Play Console → Publishing overview and press Send for review.";

export const savePlayListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        language: localeCode,
        fields: limitedFields(PLAY_TEXT_FIELDS, PLAY_LIMITS),
        /** Adds the language instead of changing an existing one. */
        create: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.create && !(PLAY_LANGUAGES as readonly string[]).includes(data.language)) {
      throw new Error(`Google Play does not accept ${data.language} as a listing language.`);
    }
    const fields = data.fields as Partial<PlayFields>;
    if ("title" in fields && !fields.title?.trim()) throw new Error("The title can't be empty.");

    const { packageName, api } = await openPlay(context.supabase, data.appId);
    const play = requirePlay(api);
    try {
      const { needsManualSend } = await withEdit(
        play,
        async (edit) => {
          const path = `${edit}/listings/${data.language}`;
          if (data.create) {
            await play.call("PUT", path, { language: data.language, ...fields });
          } else {
            await play.call("PATCH", path, fields);
          }
        },
        { commit: true },
      );
      const verb = data.create ? "added" : "saved";
      return {
        message: `${localeLabel(data.language)} ${verb}. ${needsManualSend ? MANUAL_SEND_NOTE : REVIEW_NOTE}`,
        needsManualSend,
      };
    } catch (err) {
      throw new Error(describePlayError(err, play, packageName));
    }
  });

export const savePlayDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        details: z
          .object({ contactEmail: z.string().max(255), contactWebsite: z.string().max(255) })
          .partial(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const details = Object.fromEntries(
      PLAY_DETAIL_FIELDS.filter((f) => f in data.details).map((f) => [f, data.details[f]]),
    );
    if ("contactEmail" in details && !details.contactEmail?.trim()) {
      throw new Error("Google Play requires a contact email.");
    }
    const { packageName, api } = await openPlay(context.supabase, data.appId);
    const play = requirePlay(api);
    try {
      const { needsManualSend } = await withEdit(
        play,
        (edit) => play.call("PATCH", `${edit}/details`, details),
        { commit: true },
      );
      return {
        message: `Contact details saved. ${needsManualSend ? MANUAL_SEND_NOTE : REVIEW_NOTE}`,
      };
    } catch (err) {
      throw new Error(describePlayError(err, play, packageName));
    }
  });

export const removePlayLanguage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), language: localeCode }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { packageName, api } = await openPlay(context.supabase, data.appId);
    const play = requirePlay(api);
    try {
      const { needsManualSend } = await withEdit(
        play,
        async (edit) => {
          const details = await play.call("GET", `${edit}/details`);
          if (details.defaultLanguage === data.language) {
            throw new Error("The default language can't be removed.");
          }
          await play.call("DELETE", `${edit}/listings/${data.language}`);
        },
        { commit: true },
      );
      return {
        message: `${localeLabel(data.language)} removed. ${needsManualSend ? MANUAL_SEND_NOTE : REVIEW_NOTE}`,
      };
    } catch (err) {
      throw new Error(describePlayError(err, play, packageName));
    }
  });

// Image changes on Play are batched in one edit the browser drives: open it, apply each
// deletion and upload in its own call (images are too big to send together), then
// commit once, so Google reviews the whole batch together.

const playImageType = z.enum(PLAY_IMAGE_TYPES.map(([t]) => t) as [string, ...string[]]);
const playEditId = z.string().regex(/^[\w-]{1,100}$/);

function tagChange(err: unknown) {
  if (err instanceof PlayError) err.stage = "change";
  return err;
}

export const startPlayImageEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ appId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { packageName, api } = await openPlay(context.supabase, data.appId);
    const play = requirePlay(api);
    try {
      const editPath = await openEdit(play);
      return { editId: editPath.replace("/edits/", "") };
    } catch (err) {
      throw new Error(describePlayError(err, play, packageName));
    }
  });

export const changePlayImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        appId: z.string().uuid(),
        editId: playEditId,
        language: localeCode,
        imageType: playImageType,
        change: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("delete"), imageId: z.string().regex(/^[\w-]{1,200}$/) }),
          z.object({
            kind: z.literal("upload"),
            contentType: z.enum(["image/png", "image/jpeg"]),
            // About 8 MB of image once decoded.
            dataBase64: z.string().min(1).max(11_500_000),
          }),
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { packageName, api } = await openPlay(context.supabase, data.appId);
    const play = requirePlay(api);
    const path = `/edits/${data.editId}/listings/${data.language}/${data.imageType}`;
    try {
      if (data.change.kind === "delete") {
        await play.call("DELETE", `${path}/${data.change.imageId}`);
      } else {
        if (PLAY_IMAGE_RULES[data.imageType]?.png && data.change.contentType !== "image/png") {
          throw new Error("Google Play needs the icon as a PNG.");
        }
        const bytes = Uint8Array.from(atob(data.change.dataBase64), (c) => c.charCodeAt(0));
        await play.upload(path, bytes, data.change.contentType);
      }
      return { ok: true };
    } catch (err) {
      throw new Error(describePlayError(tagChange(err), play, packageName));
    }
  });

export const commitPlayImageEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), editId: playEditId }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { packageName, api } = await openPlay(context.supabase, data.appId);
    const play = requirePlay(api);
    const editPath = `/edits/${data.editId}`;
    try {
      const needsManualSend = await commitEdit(play, editPath);
      return {
        message: `Graphics sent. ${needsManualSend ? MANUAL_SEND_NOTE : REVIEW_NOTE}`,
      };
    } catch (err) {
      await play.call("DELETE", editPath).catch(() => {});
      throw new Error(describePlayError(tagChange(err), play, packageName));
    }
  });

export const discardPlayImageEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ appId: z.string().uuid(), editId: playEditId }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { api } = await openPlay(context.supabase, data.appId);
    await requirePlay(api)
      .call("DELETE", `/edits/${data.editId}`)
      .catch(() => {});
    return { ok: true };
  });
