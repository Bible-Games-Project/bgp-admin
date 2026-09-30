// TestFlight for the Testers page: each game's tester groups, the build testers get, and
// the steps to let people outside the team in (invite by email, public link, sending a
// build to Apple's beta review). Everything goes through the App Store Connect API with
// the deploy key, which has the Admin role.

import { type AscApi, AscError, createAscApi, findAscApp } from "./asc.server";

export type BetaTester = {
  id: string;
  email: string | null;
  name: string;
  /** INVITED, ACCEPTED, INSTALLED… null for testers Apple hasn't reported on. */
  state: string | null;
};

export type BetaGroup = {
  id: string;
  name: string;
  internal: boolean;
  testers: BetaTester[];
  publicLinkEnabled: boolean;
  publicLink: string | null;
};

export type TestBuild = {
  id: string;
  /** The app version, e.g. "1.0.74". */
  version: string;
  /** The build number, e.g. "74". */
  build: string;
  uploaded: string | null;
  /** READY_FOR_BETA_SUBMISSION, WAITING_FOR_BETA_REVIEW, BETA_APPROVED… */
  externalState: string | null;
  /** Already in the external testers' group. */
  inExternalGroup: boolean;
};

export type TestFlight =
  | { found: false; problem?: string }
  | {
      found: true;
      ascId: string;
      team: BetaGroup[];
      /** The group for people outside the team; null until the first invite creates it. */
      external: BetaGroup | null;
      /** The newest usable build. */
      build: TestBuild | null;
    };

/** The group the console creates for testers outside the team. */
export const EXTERNAL_GROUP_NAME = "External testers";

const NOT_CONNECTED = "App Store Connect is not connected to this console.";

export async function requireAsc(): Promise<AscApi> {
  const api = await createAscApi();
  if (!api) throw new Error(NOT_CONNECTED);
  return api;
}

function testerOf(t: any): BetaTester {
  const a = t.attributes ?? {};
  return {
    id: t.id,
    email: a.email ?? null,
    name: [a.firstName, a.lastName].filter(Boolean).join(" "),
    state: a.state ?? null,
  };
}

async function groupsOf(api: AscApi, ascId: string): Promise<BetaGroup[]> {
  const page = await api.get(
    `/v1/apps/${ascId}/betaGroups?limit=50&fields[betaGroups]=name,isInternalGroup,publicLinkEnabled,publicLink`,
  );
  return Promise.all(
    (page.data ?? []).map(async (g: any) => {
      const testers = await api.get(
        `/v1/betaGroups/${g.id}/betaTesters?limit=200&fields[betaTesters]=firstName,lastName,email,state`,
      );
      return {
        id: g.id,
        name: g.attributes?.name ?? "",
        internal: !!g.attributes?.isInternalGroup,
        testers: (testers.data ?? []).map(testerOf),
        publicLinkEnabled: !!g.attributes?.publicLinkEnabled,
        publicLink: g.attributes?.publicLink ?? null,
      };
    }),
  );
}

async function latestBuild(
  api: AscApi,
  ascId: string,
  external: BetaGroup | null,
): Promise<TestBuild | null> {
  const page = await api.get(
    `/v1/builds?filter[app]=${ascId}&filter[expired]=false&filter[processingState]=VALID&sort=-uploadedDate&limit=1` +
      "&include=buildBetaDetail,preReleaseVersion" +
      "&fields[builds]=version,uploadedDate,buildBetaDetail,preReleaseVersion" +
      "&fields[buildBetaDetails]=externalBuildState&fields[preReleaseVersions]=version",
  );
  const b = page.data?.[0];
  if (!b) return null;
  const included = new Map<string, any>(
    (page.included ?? []).map((i: any) => [`${i.type}:${i.id}`, i]),
  );
  const detail = included.get(`buildBetaDetails:${b.relationships?.buildBetaDetail?.data?.id}`);
  const pre = included.get(`preReleaseVersions:${b.relationships?.preReleaseVersion?.data?.id}`);
  let inExternalGroup = false;
  if (external) {
    const groups = await api.get(`/v1/builds/${b.id}/relationships/betaGroups?limit=50`);
    inExternalGroup = (groups.data ?? []).some((g: any) => g.id === external.id);
  }
  return {
    id: b.id,
    version: pre?.attributes?.version ?? "",
    build: b.attributes?.version ?? "",
    uploaded: b.attributes?.uploadedDate ?? null,
    externalState: detail?.attributes?.externalBuildState ?? null,
    inExternalGroup,
  };
}

export async function readTestFlight(bundleId: string): Promise<TestFlight> {
  const api = await createAscApi();
  if (!api) return { found: false, problem: NOT_CONNECTED };
  const app = await findAscApp(api, bundleId);
  if (!app) return { found: false };
  const groups = await groupsOf(api, app.id);
  const external = groups.find((g) => !g.internal) ?? null;
  return {
    found: true,
    ascId: app.id,
    team: groups.filter((g) => g.internal),
    external,
    build: await latestBuild(api, app.id, external),
  };
}

/** The external testers' group, created the first time it's needed. */
export async function externalGroup(api: AscApi, ascId: string): Promise<string> {
  const page = await api.get(
    `/v1/apps/${ascId}/betaGroups?limit=50&fields[betaGroups]=name,isInternalGroup`,
  );
  const existing = (page.data ?? []).find((g: any) => !g.attributes?.isInternalGroup);
  if (existing) return existing.id;
  const created = await api.post("/v1/betaGroups", {
    data: {
      type: "betaGroups",
      attributes: { name: EXTERNAL_GROUP_NAME },
      relationships: { app: { data: { type: "apps", id: ascId } } },
    },
  });
  return created.data.id;
}

/**
 * Adds someone to the external group. Apple emails the invitation once the group has a
 * build it approved for testing.
 */
export async function inviteTester(
  ascId: string,
  tester: { email: string; firstName?: string; lastName?: string },
): Promise<void> {
  const api = await requireAsc();
  const groupId = await externalGroup(api, ascId);
  try {
    await api.post("/v1/betaTesters", {
      data: {
        type: "betaTesters",
        attributes: {
          email: tester.email,
          firstName: tester.firstName || undefined,
          lastName: tester.lastName || undefined,
        },
        relationships: { betaGroups: { data: [{ type: "betaGroups", id: groupId }] } },
      },
    });
  } catch (err) {
    // Someone already testing another game: add the existing tester to this group.
    if (!(err instanceof AscError && err.status === 409)) throw err;
    const found = await api.get(
      `/v1/betaTesters?filter[email]=${encodeURIComponent(tester.email)}&limit=1`,
    );
    const id = found.data?.[0]?.id;
    if (!id) throw err;
    await api.post(`/v1/betaGroups/${groupId}/relationships/betaTesters`, {
      data: [{ type: "betaTesters", id }],
    });
  }
}

export async function removeTester(groupId: string, testerId: string): Promise<void> {
  const api = await requireAsc();
  await api.delete(`/v1/betaGroups/${groupId}/relationships/betaTesters`, {
    data: [{ type: "betaTesters", id: testerId }],
  });
}

export async function setPublicLink(ascId: string, enabled: boolean): Promise<void> {
  const api = await requireAsc();
  const groupId = await externalGroup(api, ascId);
  await api.patch(`/v1/betaGroups/${groupId}`, {
    data: {
      type: "betaGroups",
      id: groupId,
      attributes: {
        publicLinkEnabled: enabled,
        ...(enabled ? { publicLinkLimitEnabled: false } : {}),
      },
    },
  });
}

const CONTACT_FIELDS = ["contactFirstName", "contactLastName", "contactPhone", "contactEmail"];
const hasContact = (a: any) => !!a && CONTACT_FIELDS.every((k) => (a[k] ?? "").trim());

/** The App Review contact of this app's versions, or of any other app in the account. */
async function reviewContact(api: AscApi, ascId: string): Promise<Record<string, string> | null> {
  const fields = `fields[appStoreReviewDetails]=${CONTACT_FIELDS.join(",")}`;
  const own = await api.get(
    `/v1/apps/${ascId}/appStoreVersions?limit=20&include=appStoreReviewDetail&${fields}`,
  );
  let found = (own.included ?? []).find((i: any) => hasContact(i.attributes));
  if (!found) {
    const apps = await api.get("/v1/apps?limit=50&fields[apps]=bundleId");
    for (const other of apps.data ?? []) {
      if (other.id === ascId) continue;
      const page = await api.get(
        `/v1/apps/${other.id}/appStoreVersions?limit=5&include=appStoreReviewDetail&${fields}`,
      );
      found = (page.included ?? []).find((i: any) => hasContact(i.attributes));
      if (found) break;
    }
  }
  return found ? Object.fromEntries(CONTACT_FIELDS.map((k) => [k, found.attributes[k]])) : null;
}

/**
 * Apple asks for "Test Information" before it reviews a build for outside testers: a
 * contact, a feedback email, a description and a privacy policy. Whatever is missing is
 * filled in from the game's App Store listing and App Review contact.
 */
async function fillTestInformation(api: AscApi, ascId: string, appName: string): Promise<void> {
  const detail = await api.get(`/v1/apps/${ascId}/betaAppReviewDetail`);
  const current = detail.data?.attributes ?? {};
  const contact = hasContact(current) ? null : await reviewContact(api, ascId);
  if (!hasContact(current) && !contact) {
    throw new Error(
      "Apple needs a contact for the testing review, and no App Store version in this account has an App Review contact to copy. Fill it in once in App Store Connect → this game → TestFlight → Test Information, then try again.",
    );
  }
  if (contact) {
    await api.patch(`/v1/betaAppReviewDetails/${detail.data.id}`, {
      data: { type: "betaAppReviewDetails", id: detail.data.id, attributes: contact },
    });
  }
  const feedbackEmail = contact?.contactEmail ?? current.contactEmail;

  const localizations = await api.get(`/v1/apps/${ascId}/betaAppLocalizations?limit=50`);
  if (!(localizations.data ?? []).length) {
    const infos = await api.get(
      `/v1/apps/${ascId}/appInfos?limit=5&include=appInfoLocalizations&fields[appInfoLocalizations]=locale,privacyPolicyUrl`,
    );
    const privacy = (infos.included ?? [])
      .map((i: any) => i.attributes?.privacyPolicyUrl)
      .find((url: string | undefined) => url);
    await api.post("/v1/betaAppLocalizations", {
      data: {
        type: "betaAppLocalizations",
        attributes: {
          locale: "en-US",
          feedbackEmail,
          description: `${appName}, a game by Bible Games Project. Thank you for trying it before it comes out: tell us anything that doesn't work or could be better.`,
          ...(privacy ? { privacyPolicyUrl: privacy } : {}),
        },
        relationships: { app: { data: { type: "apps", id: ascId } } },
      },
    });
  }
}

/**
 * Puts a build in the external testers' group and sends it to Apple's beta review, which
 * usually answers within a day. Apple reviews the first build of each version; the next
 * builds of the same version usually go straight to testers.
 */
export async function sendBuildToTesters(
  ascId: string,
  buildId: string,
  appName: string,
): Promise<{ submitted: boolean }> {
  const api = await requireAsc();
  await fillTestInformation(api, ascId, appName);
  const groupId = await externalGroup(api, ascId);

  // "What to Test", which testers see in TestFlight.
  const locs = await api.get(`/v1/builds/${buildId}/betaBuildLocalizations?limit=10`);
  if (!(locs.data ?? []).some((l: any) => l.attributes?.whatsNew)) {
    await api.post("/v1/betaBuildLocalizations", {
      data: {
        type: "betaBuildLocalizations",
        attributes: {
          locale: "en-US",
          whatsNew: "Play as you normally would and tell us anything that doesn't work.",
        },
        relationships: { build: { data: { type: "builds", id: buildId } } },
      },
    });
  }

  await api.post(`/v1/betaGroups/${groupId}/relationships/builds`, {
    data: [{ type: "builds", id: buildId }],
  });
  try {
    await api.post("/v1/betaAppReviewSubmissions", {
      data: {
        type: "betaAppReviewSubmissions",
        relationships: { build: { data: { type: "builds", id: buildId } } },
      },
    });
    return { submitted: true };
  } catch (err) {
    // Already approved (a later build of a version Apple reviewed) or already submitted.
    if (err instanceof AscError && err.status === 409) return { submitted: false };
    throw err;
  }
}
