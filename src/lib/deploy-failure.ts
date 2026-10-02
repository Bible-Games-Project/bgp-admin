// Why a deploy failed, in words someone without store-publishing knowledge can act on:
// the error lines pulled out of the failed GitHub Actions job's log, who has to fix it
// (the person deploying, in App Store Connect or Play Console; the developer; or nobody,
// because deploying again is enough), and a ready-made question for an AI chat. Pure, so
// every rule can be tested against real logs; deploy.functions.ts fetches the logs.

/** Who has to act. */
export type FailureOwner = "you" | "developer" | "retry" | "unknown";

export type FailureVerdict = {
  owner: FailureOwner;
  /** Where "you" fix it. */
  where: "App Store Connect" | "Google Play Console" | "the console" | null;
  /** What went wrong, in one sentence. */
  summary: string;
  /** What to do about it. */
  todo: string;
};

export type FailedJob = {
  /** e.g. "ios / Build & Deploy iOS". */
  job: string;
  /** The step that failed, e.g. "Submit build for App Store review"; null when GitHub has none. */
  step: string | null;
  /** The error lines, cleaned up; empty when the log couldn't be read. */
  error: string;
  verdict: FailureVerdict;
};

/** Most of an xcodebuild or Gradle log is progress; this many lines before the error tell the story. */
const TAIL_LINES = 40;
/** Earlier lines that say "error" are kept too, up to this many. */
const MAX_EARLIER_ERRORS = 15;
const MAX_CHARS = 6000;

const TIMESTAMP = /^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
/** Lines GitHub or Node print on every run, which only bury the error. */
const NOISE = [
  /Node 20 is being deprecated/,
  /DeprecationWarning/,
  /--trace-deprecation/,
  /^##\[warning\]/,
  /^##\[debug\]/,
];

/**
 * The failed step's output up to and including GitHub's error lines, from a job's raw
 * log (GET /repos/{repo}/actions/jobs/{id}/logs). Empty when the log has no error line.
 */
export function failureExcerpt(log: string): string {
  const lines = log.split(/\r?\n/).map((l) => l.replace(TIMESTAMP, "").replace(ANSI, ""));
  const firstError = lines.findIndex((l) => l.startsWith("##[error]"));
  if (firstError < 0) return "";

  // The failed step's output starts after its header: "##[group]Run <command>", the
  // command, its environment, then "##[endgroup]".
  let start = 0;
  for (let i = firstError; i >= 0; i--) {
    if (lines[i].startsWith("##[group]Run ")) {
      const end = lines.findIndex((l, j) => j > i && l.startsWith("##[endgroup]"));
      start = end >= 0 && end < firstError ? end + 1 : i + 1;
      break;
    }
  }

  // The error lines themselves, which can run over several lines, until the next step
  // or the post-job cleanup begins.
  let stop = firstError + 1;
  while (
    stop < lines.length &&
    !lines[stop].startsWith("##[group]") &&
    !lines[stop].startsWith("Post job cleanup")
  ) {
    stop++;
  }

  const output = lines
    .slice(start, stop)
    .filter((l) => l.trim() && !NOISE.some((n) => n.test(l)))
    .map((l) => l.replace(/^##\[error\]/, "Error: "));

  const tailFrom = Math.max(0, output.length - TAIL_LINES);
  const earlier = output
    .slice(0, tailFrom)
    .filter((l) => /\berror\b|❌|failed/i.test(l))
    .slice(-MAX_EARLIER_ERRORS);
  const kept = [...earlier, ...(earlier.length ? ["…"] : []), ...output.slice(tailFrom)];
  const text = kept.join("\n").trim();
  return text.length > MAX_CHARS ? `…${text.slice(-MAX_CHARS)}` : text;
}

/* ------------------------------------------------------------------------------------ */
/* Who fixes it                                                                          */
/* ------------------------------------------------------------------------------------ */

type Rule = { test: RegExp; verdict: FailureVerdict };

const ASC = "App Store Connect" as const;
const PLAY = "Google Play Console" as const;

const you = (where: FailureVerdict["where"], summary: string, todo: string): FailureVerdict => ({
  owner: "you",
  where,
  summary,
  todo,
});

const developer = (summary: string, todo = SEND_TO_DEVELOPER): FailureVerdict => ({
  owner: "developer",
  where: null,
  summary,
  todo,
});

const SEND_TO_DEVELOPER =
  "Nothing to change in the stores. Copy the error below and send it to the developer.";

// Checked in order: the first match wins, so the specific store messages come before
// the broad "the build broke" ones.
const RULES: Rule[] = [
  // App Store Connect: things only the account's owner can fill in.
  {
    test: /appStoreReviewDetails|contact(First|Last)Name|contactEmail|contactPhone/,
    verdict: you(
      ASC,
      "App Store Connect is missing the contact details Apple's reviewers use.",
      "In App Store Connect open the game, then the version being prepared (iOS App, left column). At the bottom, under App Review Information («Información para el equipo de revisión de apps»), fill in first name, last name, phone and email. The phone must start with + and the country code, like +34 600 000 000. Save, then deploy again.",
    ),
  },
  {
    test: /privacyPolicyUrl|privacy policy/i,
    verdict: you(
      ASC,
      "App Store Connect needs a link to the game's privacy policy.",
      "In App Store Connect open the game → App Privacy («Privacidad de la app») and fill in the Privacy Policy URL. Save, then deploy again.",
    ),
  },
  {
    test: /appDataUsage|data usage|App Privacy|privacy details/i,
    verdict: you(
      ASC,
      "App Store Connect is missing the game's App Privacy answers.",
      "In App Store Connect open the game → App Privacy («Privacidad de la app»), answer what data the game collects and press Publish. Then deploy again.",
    ),
  },
  {
    test: /ageRating/i,
    verdict: you(
      ASC,
      "App Store Connect is missing the game's age rating.",
      "In App Store Connect open the game → App Information («Información de la app») → Age Rating («Clasificación por edades»), answer the questionnaire and save. Then deploy again.",
    ),
  },
  {
    test: /contentRightsDeclaration|content rights/i,
    verdict: you(
      ASC,
      "App Store Connect needs to know whether the game uses content owned by others.",
      "In App Store Connect open the game → App Information («Información de la app») → Content Rights («Derechos de contenido»), answer and save. Then deploy again.",
    ),
  },
  {
    test: /primaryCategory/,
    verdict: you(
      ASC,
      "App Store Connect is missing the game's category.",
      "In App Store Connect open the game → App Information («Información de la app») and pick a category. Save, then deploy again.",
    ),
  },
  {
    test: /appScreenshot|screenshot/i,
    verdict: you(
      ASC,
      "The App Store listing is missing screenshots.",
      "Add the screenshots in the game's Store tab here in the console (or in App Store Connect), then deploy again.",
    ),
  },
  {
    test: /appStoreVersionLocalizations|appInfoLocalizations|'(description|keywords|supportUrl)'/,
    verdict: you(
      ASC,
      "The App Store listing is missing some text.",
      "Fill in the description, keywords and support URL in the game's Store tab here in the console (or in App Store Connect), then deploy again.",
    ),
  },
  {
    test: /agreement|\bPLA\b/i,
    verdict: you(
      ASC,
      "Apple has a new agreement waiting to be accepted, and blocks uploads until it is.",
      "The Apple account's owner signs in to App Store Connect, opens Business («Negocio») or the banner at the top, and accepts the new agreement. Then deploy again.",
    ),
  },
  {
    test: /already (WAITING_FOR_REVIEW|IN_REVIEW|UNRESOLVED_ISSUES) for a different version/,
    verdict: you(
      ASC,
      "Apple is already handling another version of this game, and takes only one at a time.",
      "If that version is waiting for review or in review, wait for Apple's answer. If Apple rejected it, open it in App Store Connect and either answer Apple or remove it from review. Then deploy again.",
    ),
  },
  {
    test: /cannot create a new version of the App in the current state/,
    verdict: you(
      ASC,
      "App Store Connect won't open a new version while another one is still with Apple.",
      "In App Store Connect, look at the game's latest version. Waiting for review or in review: wait for Apple. Approved and waiting for you: release it (Home has a button). Rejected: answer Apple or remove it from review. Then deploy again.",
    ),
  },
  {
    test: /must contain a higher version|train version .* is closed|bundle version must be higher|previously approved version/i,
    verdict: you(
      "the console",
      "That version number was already used on the App Store.",
      "Deploy again with a higher version number than the one on the App Store (the deploy panel suggests one).",
    ),
  },

  // Google Play.
  {
    test: /caller does not have permission/i,
    verdict: you(
      PLAY,
      "Google Play didn't let the console publish this game.",
      "In Play Console open Users and permissions («Usuarios y permisos»), find the console's service account (the address ending in iam.gserviceaccount.com), give it access to this game and tick the permissions to release to testing and to production. Save, then deploy again.",
    ),
  },
  {
    test: /status draft may be created on draft app/i,
    verdict: you(
      PLAY,
      "The game isn't published on Google Play yet, so Google accepts only drafts.",
      "In Play Console open the game's Dashboard («Panel de control»), finish every setup task it lists and send the first release for review by hand. After Google approves it, deploys from the console work on their own.",
    ),
  },
  {
    test: /changes cannot be sent for review automatically|changesNotSentForReview/i,
    verdict: you(
      PLAY,
      "Google Play wants this game's changes sent for review by hand.",
      "In Play Console open the game → Publishing overview («Resumen de la publicación») and press Send changes for review («Enviar cambios para revisión»). Then deploy again.",
    ),
  },
  {
    test: /Package not found|No application was found for the given package name/i,
    verdict: developer(
      "Google Play doesn't know this game yet: its very first version has to be uploaded by hand.",
      "Make sure the game exists in Play Console. Then send the error below to the developer, who prepares the first file to upload there by hand.",
    ),
  },
  {
    test: /Precondition check failed/i,
    verdict: you(
      PLAY,
      "Google Play refused the release for a reason it shows in Play Console.",
      "In Play Console open the game's Dashboard («Panel de control») and Publishing overview («Resumen de la publicación») and finish whatever they flag, often the App content declarations («Contenido de la aplicación»). Then deploy again.",
    ),
  },
  {
    test: /release notes.*(too long|500)|whatsnew.*(too long|500)/i,
    verdict: you(
      "the console",
      "The release notes are longer than Google Play allows (500 characters).",
      "Deploy again with shorter release notes.",
    ),
  },

  // Deploying again is enough.
  {
    test: /This Edit has been deleted|edit has expired/i,
    verdict: {
      owner: "retry",
      where: null,
      summary: "Two uploads to Google Play overlapped and Google dropped one.",
      todo: "Deploy again, once. If it fails the same way twice, send the error below to the developer.",
    },
  },
  {
    test: /ETIMEDOUT|ECONNRESET|socket hang up|502 Bad Gateway|503 Service|Internal Server Error|rate limit|The request timed out/i,
    verdict: {
      owner: "retry",
      where: null,
      summary: "A store or GitHub didn't answer in time.",
      todo: "Deploy again. If it fails the same way twice, send the error below to the developer.",
    },
  },

  // The developer's: code, signing, versions and the pipeline itself.
  {
    test: /version ?code \d* ?(has )?already been used/i,
    verdict: developer("Google Play already has a build with this build number."),
  },
  {
    test: /targetSdk|targets? API level|targets? SDK/i,
    verdict: developer("Google Play wants the game built for a newer Android version."),
  },
  {
    test: /keystore|jarsigner|security: failed to decode|No signing certificate|No profile for|signing certificate .* (expired|revoked)/i,
    verdict: developer("The game's signing keys stored in GitHub are missing or wrong."),
  },
  {
    test: /ITMS-\d+/,
    verdict: developer("Apple refused the uploaded build file itself."),
  },
  {
    test: /Unable to resolve action/,
    verdict: developer("GitHub couldn't find a building block the deploy uses."),
  },
];

/** Rules on the failed step's name, when the error itself says nothing known. */
const STEP_RULES: { test: RegExp; verdict: FailureVerdict }[] = [
  {
    test: /certificat|provisioning|keystore|sign/i,
    verdict: developer("The game's signing keys stored in GitHub are missing or wrong."),
  },
  {
    test: /build|xcarchive|gradle|install|dependencies|capacitor|sync/i,
    verdict: developer("The game didn't build. That needs a change in its code or setup."),
  },
];

const UNKNOWN: FailureVerdict = {
  owner: "unknown",
  where: null,
  summary: "The console doesn't recognise this error.",
  todo: "Copy the error below into an AI chat and ask what it means. If the fix is something to fill in or accept in App Store Connect or Google Play Console, it's yours; if it means changing code, send it to the developer.",
};

/** Who has to fix a failed job, and how. */
export function explainFailure(input: {
  step: string | null;
  error: string;
  conclusion?: string | null;
}): FailureVerdict {
  // The error lines first: the output around them can mention words like "keystore" or
  // "provisioning profile" in passing.
  const errorLines = input.error
    .split("\n")
    .filter((l) => /error|❌|•|failed|refused|denied|invalid/i.test(l))
    .join("\n");
  const rule =
    RULES.find((r) => r.test.test(errorLines)) ?? RULES.find((r) => r.test.test(input.error));
  if (rule) return rule.verdict;
  if (input.conclusion === "timed_out" || input.conclusion === "cancelled") {
    return {
      owner: "retry",
      where: null,
      summary:
        input.conclusion === "timed_out"
          ? "The deploy took longer than GitHub allows and was stopped."
          : "The deploy was stopped before it finished.",
      todo: "Deploy again. If it fails the same way twice, send the error below to the developer.",
    };
  }
  const byStep = input.step ? STEP_RULES.find((r) => r.test.test(input.step!)) : null;
  return byStep?.verdict ?? UNKNOWN;
}

/** Text to paste into an AI chat: enough context for a useful answer, nothing secret. */
export function aiChatPrompt(input: {
  game: string;
  job: string;
  step: string | null;
  error: string;
}): string {
  return [
    `I publish a mobile game ("${input.game}") to the App Store and Google Play with a GitHub Actions workflow, and a deploy failed.`,
    `Job: ${input.job}`,
    `Failed step: ${input.step ?? "unknown"}`,
    "",
    "Error log:",
    input.error || "(the log couldn't be read)",
    "",
    "What does this error mean? If I can fix it myself in App Store Connect or Google Play Console, tell me exactly where to click. If it needs a code change, say so.",
  ].join("\n");
}
