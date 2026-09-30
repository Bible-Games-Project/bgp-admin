# Roadmap: Home, alerts, downloads, testers

Work agreed with Pau on 2026-09-30. This file tracks it so no session loses the thread:
tick items as they ship, add the commit, and note anything left open.

Every visible feature ends with a Trello card for Joan (list **Joan**, assigned to him,
written in Catalan) saying what shipped and how to try it.

## Status

| # | Item | Status | Commit | Trello |
| --- | --- | --- | --- | --- |
| 0 | Tech debt: exact bundle ID match in deploy-ios.yml | done | 41179c8 | — |
| 0 | Tech debt: remove the RevenueCat webhook and the purchases tables | done | d5bbf73 | — |
| 1 | Monitor job (the base for Home and alerts) | done | 7819f38 | — |
| 2 | Home page: what needs attention | done | 7819f38 | [#31](https://trello.com/c/R10wvjXf) |
| 3 | Expirations and yearly requirements on Home | done | 7819f38 | #31 |
| 4 | Google Play crashes and ANRs on Home | done | 7819f38 | #31 |
| 5 | Telegram alerts and weekly summary | done; no alert seen live yet | 7819f38 | [#32](https://trello.com/c/jh9c3KQo) |
| 6 | Notifications settings (test message, move to a group) | done; test message works (Pau, 2026-09-30); group waits for Joan to join Telegram | dcba79f | #32 |
| 7 | Downloads page and demo → full conversion | done | c03c0a2 | [#33](https://trello.com/c/YlTs7lpL) |
| 8 | Testers page (TestFlight, Google Play testing) | done; writes not yet tried on the real stores | 6bc4cbd | [#34](https://trello.com/c/8cQKcJ67) |

## Design

### Monitor job

A second scheduled task on the Worker, `monitor:run` (`src/tasks/monitor.ts`), every
15 minutes. It runs the checks that are due and stores each one's result in the table
`monitor_checks` (`key`, `ran_at`, `state` jsonb, `problem`). Home reads that table, so it
loads fast and never calls the stores itself; a **Check now** button runs the job.

Cloudflare's free plan allows 50 outgoing requests per run, database and Telegram calls
included. Each check has an interval and a request cost that grows with the number of
games; a run takes due checks, most overdue first, until the budget is spent. The rest
wait for the next run.

| Check | Every | Source | Requests |
| --- | --- | --- | --- |
| `app_store` | 15 min | ASC `/v1/apps?include=appStoreVersions` + open `reviewSubmissions` | 2 |
| `reviews` | 1 h | ASC `customerReviews`, Play `reviews.list`, Steam `appreviews` | 1 per game per store |
| `deploys` | 30 min | GitHub: last `deploy.yml` run of each web game | 1 per web game |
| `play_vitals` | 6 h | Play Developer Reporting `errorCountMetricSet`, `errorIssues:search` | 1–2 per Android game |
| `signing` | 24 h | ASC `/v1/certificates`, `/v1/profiles` | 2 |
| `console` | 24 h | GitHub token expiry header, nightly backup runs, workflows disabled for inactivity | 3 |
| `android_target` | 24 h | `android/variables.gradle` of each web game repo | 1 per Android web game |

Checked against the real APIs on 2026-09-30 with the local keys:
- One ASC call returns every app with its latest versions and states.
- Play's crash-rate metric sets return no rows for games this small, because Google
  hides rates below a user threshold. `errorCountMetricSet` (crash and ANR reports and
  users per day) does answer, and `errorIssues:search` gives each issue's cause and a
  Play Console link. It needs the time zone `UTC`, not `America/Los_Angeles`.
- Every Android web game targets API 36 (Capacitor 8), which Google requires since
  2026-08-31. The next step (API 37 by 2027-08-31) is an assumption from Google's
  yearly pattern; the table lives in code.
- The distribution certificate and the App Store profiles expire on 2027-05-28.

### Home (`/`)

- **Needs attention**: each item says what is wrong and has the button that fixes it.
  - An App Store version rejected, or approved and waiting to be released.
  - The last deploy of a game failed.
  - Low-rated reviews (3 stars or less) from the last 60 days with no reply.
  - A game crashing on Android (reports from several players in the last 7 days, or
    over Google's bad-behaviour threshold when Google publishes the rate).
  - Store reports the income job cannot read (`income_sync.problem`).
  - The nightly backup failed, or GitHub disabled a scheduled workflow for inactivity.
- **Coming up**: expirations within 60 days, soonest first. Distribution certificate,
  App Store provisioning profiles, the console's GitHub token, the Android target API
  deadline, and yearly expenses that renew soon (for example the Apple Developer
  Program, if it is entered in Expenses). Apple has no API for the membership date,
  so Home offers to add it as a yearly expense when none looks like it.
- **At a glance**: this month's income against last month, reviews this week, games
  in App Review.
- `/dashboard` and sign-in land here. The sidebar gets **Home** first.

### Telegram

Sent by the monitor job with the bot the deploy workflows already use.
- New reviews, highlighting 3 stars or less (Steam: not recommended).
- Apple starts reviewing, approves or rejects a version.
- A game starts crashing on Android.
- Expirations at 60, 30, 7 and 1 days.
- The nightly backup failed.
- Weekly summary on Mondays at 09:00 Madrid time: month so far, last month, year's
  profit, the week's reviews.

The first run of each check only records what exists, so nothing old is announced.
Deploy results are not repeated: `notify-telegram.yml` already sends them.

**Moving the chat to a group** (Pau will do it later): Settings → Notifications shows
where messages go and sends a test. "Move to a group" asks to add the bot to the group,
finds it through `getUpdates`, and then updates `TELEGRAM_CHAT_ID` everywhere at once:
the console's own setting (table `app_settings`), the bgp-admin repo secret, and every
web game's repo secret, which their deploy notifications read.

### Downloads (`/downloads`)

- App Store: first-time downloads from the same SALES reports the income job reads
  (product types 1, 1F, 1T, F1…), which it currently skips because they carry no
  money. The income job keeps them in a new table `download_reports`; reports already
  stored are read once more to fill it.
- Google Play: `stats/installs/installs_<package>_<YYYYMM>_overview.csv` in the reports
  bucket (daily user installs, active devices). Same permission as Revenue, still
  propagating on 2026-09-30.
- Conversion: for a free game with in-app purchases, purchases per download; for a
  demo, full-game sales per demo download. A demo points at its full game with a new
  column `apps.full_game_id`, set in the Demos card of the Downloads page itself, next
  to the numbers it changes (Didactic Jesus Demo → Didactic Jesus Game (Android)).
- Filters by game and period like Revenue; a **Downloads** button on each game's page.

### Testers (a tab on each game's page)

Pau asked on 2026-09-30 for Testers to be a tab of the game, not a sidebar page: testers
are managed one game at a time. It first shipped as a global `/testers` page (6bc4cbd).


- TestFlight, all through the ASC API: each game's groups and testers; invite by email
  (into an external group the console creates when missing); remove; public link on or
  off; send the latest build to external testers (Beta App Review), with its state.
- Google Play: the API only manages Google Groups on testing tracks, not email lists,
  so the page shows the testing releases and the join link, and sends people to Play
  Console to add emails.

## Tech debt

- `deploy-ios.yml` looks up the app with `filter[bundleId]`, which Apple matches
  partially, and takes `data[0]`. `asc.server.ts` already picks the exact match.
- The RevenueCat webhook (`supabase/functions/revenuecat-webhook`) and the `purchases`
  / `purchase_events` tables are unused since Revenue reads the stores' reports. The
  games' in-app purchases still use RevenueCat's SDK (the IAP addon); only the
  webhook side goes.
- A push to `deploy-app` or a merged PR in a game repo ran both the iOS and Android jobs,
  whatever the game was set up for. Fixed on 2026-09-30 at Pau's request: the generated
  deploy.yml has a `plan` job that picks the platforms by the repo's signing secrets.

## Open questions and follow-ups

- Steam revenue and wishlists: waiting for Joan's Financial API key (card #26).
- Not tried against the real services yet, handed to Joan on the Trello cards: moving
  the Telegram messages to a group, the Release it now button, and every TestFlight
  write (invite, remove, public link, send to testers). The test message works (Pau
  checked it on 2026-09-30).
- The Telegram group waits for Joan to make a Telegram account. Until then the alerts go
  to Pau's own chat, so Joan doesn't see them.
- Google Play downloads, and the demo's conversion, wait for the reports bucket
  permission (the same one Revenue waits for).
- The first production monitor run was 2026-09-30 10:17 UTC; it only recorded the
  current state, so the first Telegram alert comes with the next real change.
- The console's GitHub token (GH_PAT) reports no expiry date, so Home shows no reminder
  for it.
