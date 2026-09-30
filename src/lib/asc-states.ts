// App Store version and submission states, shared by the server code that talks to App
// Store Connect and by pure code (monitor.ts) that must not import server-only modules.

// A version App Store Connect will still let us edit and attach a build to. Anything
// else is either already with Apple or already published.
export const EDITABLE_STATES = [
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
];

// Apple holds one submission per app at a time, so a version sitting in any of these
// blocks the next release until it clears or is cancelled.
export const IN_FLIGHT_STATES = [
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_APP_STORE",
  "PROCESSING_FOR_DISTRIBUTION",
  "ACCEPTED",
];

// READY_FOR_SALE is the old `appStoreState` name, READY_FOR_DISTRIBUTION the
// `appVersionState` one that replaces it.
export const LIVE_STATES = ["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"];

// Review submissions outlive the version state: attaching a build moves a REJECTED
// version back to PREPARE_FOR_SUBMISSION, so by the time anyone opens this dialog the
// rejection is invisible on the version itself. The submission still carries it. These
// are also exactly the states deploy-ios.yml refuses to submit alongside, so surfacing
// them here turns a failure twenty minutes into a build into a disabled button.
export const OPEN_SUBMISSION_STATES = ["WAITING_FOR_REVIEW", "IN_REVIEW", "UNRESOLVED_ISSUES"];

/** Apple is migrating `appStoreState` to `appVersionState`; read whichever is there. */
export function versionStateOf(v: any): string {
  return v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? "UNKNOWN";
}
