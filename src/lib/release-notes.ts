/**
 * Fallback "What's New" text used whenever a deploy would otherwise ship with empty
 * release notes. Apple requires notes to submit a version for review, and on Google Play
 * empty notes silently carry over the previous release's text, so no deploy path is
 * allowed to end up blank.
 *
 * The reusable workflows keep their own copy of this string as a last-resort safety net
 * (see the `release-notes` handling in deploy-android.yml and deploy-ios.yml). Change all
 * three together if you reword it.
 */
export const DEFAULT_RELEASE_NOTES = "Bug fixes and performance improvements.";
