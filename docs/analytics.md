# Analytics

pcobooster.com uses one US PostHog project for marketing and product analytics. Feature flags are Cloudflare Flagship flags managed by Alchemy (see [Feature flags](environment.md#feature-flags)); PostHog feature flags are unused.

## Dashboards

- [Marketing & conversion](https://us.posthog.com/project/614621/dashboard/2127632): daily visitors, referring domains, campaigns, devices, pages, and marketing-to-app conversion.
- [Product usage & health](https://us.posthog.com/project/614621/dashboard/2127633): daily/weekly/monthly active users, feature adoption, weekly retention, completed workflows, failure reasons, and sign-in conversion. This is the project's default dashboard.
- [Web Analytics](https://us.posthog.com/project/614621/web): built-in traffic exploration; filter `surface = marketing` for public traffic.

Reporting uses America/Los_Angeles. Dashboards are saved ahead of deployment and remain empty until production events arrive. Retention cohorts require several weeks to mature.

### Dashboards as code

The project settings above, both dashboards, their tile order, and every insight on them are defined in [`packages/analytics/src/reports.ts`](../packages/analytics/src/reports.ts). They sit next to the event allowlist in `privacy.ts`, so a report can only reference events and properties the browser actually sends. The `pcobooster-posthog` Alchemy stack ([`alchemy.posthog.ts`](../alchemy.posthog.ts), stage `prod`, Cloudflare state) reconciles them with project 614621. The small PostHog providers live in `scripts/posthog/`.

Existing objects carry their PostHog IDs, so the stack adopts them in place and the links above keep working. A deploy writes only fields that differ from PostHog; an unchanged definition makes no PostHog writes. Only the listed project settings are managed; every other setting stays as configured in PostHog. Removing a definition soft-deletes an insight, which can be restored in PostHog. The project and dashboards are retained, so the stack never deletes them.

To change a dashboard:

1. Edit `reports.ts`. Add an insight without an `id` to create it; keep `id` on existing ones.
2. Run `bun run posthog:plan` (a dry run) and check that only the intended objects change.
3. Open a PR. `scripts/posthog/resources.test.ts` checks the definitions against a snapshot of the live project in `scripts/posthog/fixtures/`. Update the snapshot when a change is intended.
4. After merge, run `bun run posthog:deploy`. CI does not apply PostHog changes.

Edits made in the PostHog UI to managed fields are overwritten by the next deploy. Make them in code instead, or copy them into `reports.ts` first.

Both scripts read `POSTHOG_PERSONAL_API_KEY` from the Keychain `posthog` scope and use the saved Alchemy Cloudflare profile for state. Product CI never sees that key. Scope the key to project 614621 with `project:read`, `project:write`, `dashboard:read`, `dashboard:write`, `insight:read`, and `insight:write`.

### Deploy annotations

After `verify-deployment.ts` succeeds, the production CI job runs `scripts/posthog/annotate-deploy.ts`. It adds a project-wide annotation, "Deployed <commit sha>", so charts show when each release went live. It uses `POSTHOG_ANNOTATION_API_KEY` from the production GitHub environment, a personal API key scoped to project 614621 with only `annotation:write`. If the key is missing, or PostHog rejects the request, the step logs a warning and the deploy still succeeds.

## Collection

The shared `@pcobooster/analytics` package owns configuration and the outbound event allowlist. Both apps initialize from their Start client entries before hydration (`apps/web/src/client.tsx`, which initializes only on `/auth`, and `apps/marketing/src/client.tsx`). The product waits for a successful account response before initializing or identifying, which excludes read-only demo sessions. The anonymous marketing ID carries across the shared origin and merges into the application's user ID on authenticated use. The browser never sends names, emails, or organization names; the server sets them on the person profile (see below). Planning Center people are never identified.

| Event | Meaning | Additional properties |
| --- | --- | --- |
| `$pageview`, `$pageleave` | Public/auth page or authenticated product navigation | `surface`, `is_authenticated`, scrubbed path, browser/device, referrer/campaign |
| `marketing cta clicked` | A marketing link to the product was activated | `cta_location`: header/body |
| `sign in started` | User clicked Continue with Planning Center | None |
| `sign in failed` | Preparing the OAuth navigation failed | None |
| `app opened` | First authenticated account response in a document, or a different user identified | None |
| `workflow completed` | A selected product write resolved successfully | `operation`, `duration_ms` |
| `workflow failed` | A selected product write rejected | `operation`, bounded `error_code` |
| `$exception` | An uncaught browser error, a caught React error, or a terminal query failure, on authenticated product routes | `$exception_list`, `$exception_level`; reads also carry `operation`, `error_code`, `outcome = read_failed` |

Tracked writes: schedule assign/remove/status; plan-item create/update/delete/reorder; plan-time create/update/delete; account selection; needed-position adjustment; plan-person times; chord-chart update/create/song creation; feedback submission. Background queries and optimistic UI updates do not count as completed writes. Health charts measure client-observed write outcomes; they do not monitor uptime. Terminal query failures are separately captured as `$exception` events, including background reads and expected API faults. A successful automatic retry produces no terminal query failure. A network failure after a provider committed a write can still appear as a failure from the browser's perspective.

Active users are distinct authenticated application users with pageviews. Marketing visitors are browser/cookie identities. `app opened` is not a signup event. The marketing funnel includes returning signed-in users; the sign-in funnel measures started sign-in to app access, not new registrations. Do Not Track, ad blockers, and failed network delivery can reduce counts.

### Server activity and person profiles

The API mirrors every `activity_events` audit row to PostHog, keyed by the same Better Auth user ID the browser identifies with, so one PostHog person shows both browser usage and server-side auth and scheduling activity. Delivery is best effort: the database row is written first and remains the full audit log, and a PostHog failure is logged without affecting sign-in or writes. Only the production API Worker (`APP_ENV=production`) with `POSTHOG_PROJECT_KEY` forwards events.

| Event | Source row | Properties |
| --- | --- | --- |
| `signed in` | `auth_session_created` | `$set`: `email`, `name`, `organization_id`, `organization_name` |
| `signed out` | `auth_session_deleted` | None |
| `planning center account linked` | `auth_account_linked` | `organization_id` |
| `schedule assign attempted` | `schedule_attempt` | `success`, `status_code`, `error_code`, `service_type_id`, `plan_id`, `team_id`, `position_id`, `one_off` |
| `schedule status changed` | `schedule_status_change` | Same as above plus `schedule_status` |
| `schedule person removed` | `schedule_remove` | Same as assign |
| `feedback submitted` | `feedback` row (see [Feedback](#feedback)) | `feedback_id`, `message`, `path`, `$session_id`; `$set` like `signed in` |
| `$exception` | Unexpected API failure or provider-rejected write (see [Error tracking](#error-tracking)) | `$exception_list`, `$exception_fingerprint`, `error_code`, `path`, `method`, `request_id`, `procedure`; provider rejections also carry `provider_errors` |

Activity events also carry `source: server`, `success`, and `status_code`. IP addresses, user agents, and Planning Center person IDs stay in the database only. Person profiles pick up email, name, and church on each new sign-in, so accounts that have not signed in since this shipped remain unlabeled until they do.

## Feedback

Signed-in desktop users send feedback from **Feedback** in the sidebar footer. It is hidden for read-only demo visitors, and the server also rejects their submissions. The browser calls the `feedback.submit` procedure (`POST /api/v1/feedback`), so ad blockers and Do Not Track can't drop a report. The API writes a `feedback` row first (user ID, message, raw path, PostHog session ID, user agent). Then, in production only, it forwards a best-effort `feedback submitted` event to PostHog under the user's ID.

The event includes the message exactly as the user wrote it. It is the only PostHog event with free text. Person-detail paths become `/people/:personId`. Plan and service-type IDs remain, as they do in the schedule events. `$session_id` links the event to the session replay, but a replay exists only if that session was sampled (see below). Sampling is at 100% for launch hypercare (from October 14, 2026), so every report has a replay; lower it once launch traffic settles.

### Alerts

A PostHog destination posts each `feedback submitted` event to the `#pcobooster-alerts` Slack channel, with the message, path, the author's name, email, and church, and a replay link (`https://us.posthog.com/project/614621/replay/{event.properties.$session_id}`). Slack is connected in [Settings → Integrations](https://us.posthog.com/project/614621/settings/environment-integrations); the destination lives in [Data pipelines](https://us.posthog.com/project/614621/pipeline/destinations). Slack destinations are free on PostHog's free plan; email and generic webhooks are not.

A second destination, **Sign-ins → #pcobooster-alerts**, posts each server `signed in` event (one per new Better Auth session, web or iPhone, production only) with the person's name, email, and church from the event's `$set`, and a link to their PostHog person. Pause it in Data pipelines once launch sign-ins get too frequent to read.

Feedback forwards to PostHog only from production, so feedback sent from staging, previews, or local stays in that stage's D1 `feedback` table and never alerts.

If PostHog delivery fails, the API logs `Failed to forward feedback to PostHog` with the feedback ID. The database row remains the complete record.

## Error tracking

[Error tracking](https://us.posthog.com/project/614621/error_tracking) groups `$exception` events into issues, and the [Every failure destination](https://us.posthog.com/project/614621/functions/01a0f2fb-c7ec-0000-2b56-a1c6c9a4558a) posts every real failure a person hits to `#pcobooster-alerts`: each `$exception`, `workflow failed`, and `sign in failed` event except expected answers, whose `error_code` is `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `CONFLICT`, `ALREADY_SCHEDULED`, `POSITION_MISMATCH`, or `CLIENT_OUTDATED` (the same 4xx answers the iPhone app never reports). Server-side Planning Center 422 write rejections use the separate `PROVIDER_REJECTED` alert code, so the existing exclusion list allows them without a destination change. Their browser/iPhone response and workflow code remain `BAD_REQUEST`; ordinary input validation stays quiet. Rate limits, 5xx, network, timeout, and unknown failures, and every browser or render error, still alert. There is no issue-lifecycle, severity, or frequency filter. The filter lives on the destination in PostHog, not in code. The former new/reopened-only destinations are paused to avoid duplicate lifecycle notifications.

The Slack message carries the failure type, stable operation name, bounded error code, and the affected user's name, email, church, scrubbed app location, and person/session links when available. Those details come from existing server-managed PostHog person profiles; the browser still sends no names or email addresses. API-only failures use the service identity and may have no affected person or session. The destination was verified with a synthetic delivery test; it can be paused in its destination settings. Newly instrumented query failures require this code to reach production. Browser capture remains best effort and honors the existing production, authenticated-user, demo, and Do Not Track boundaries; events blocked or never captured cannot alert.

- **API:** `ProcedureScope` (`packages/api/src/http/procedure-scope.ts`, through `postHogProcedureReporter` in `apps/server/src/procedure-reporting.ts`) reports every procedure that answers 500 or above, defects included, plus provider-confirmed 422 write rejections (`packages/api/src/modules/analytics/posthog-exception.ts`). Other expected faults (auth, ordinary input validation, provider read validation (including POST attachment-open read actions), not found, conflicts, rate limits, cancellations) are not reported. Provider write rejections retain a server-only diagnostic field on `InvalidInput`, omitted by the fault codec; no client error-code or iPhone change is required. These `$exception` events use `PROVIDER_REJECTED`, a fixed `ProviderRejected` exception message, and up to ten `provider_errors` entries with the rejected attribute (100 characters) and provider detail (500 characters). Source attributes must exactly match the service adapter's sent attribute keys; only those keys (never values) are retained on the provider error. Only allowlisted validation phrase suffixes containing no submitted text are retained; unknown wording is replaced with `Validation failed (detail omitted for privacy)`, including messages that reflect a title or notes. The user-facing provider message remains unchanged. They exclude sent attribute values, church titles/notes, raw response bodies, and provider stacks. For 5xx failures, the event carries the root cause's type, message (truncated to 500 characters), and stack frames, plus the procedure/operation, method, the route template (such as `/api/v1/plan-people/:planPersonId`), error code, and request ID for finding the request in Workers Logs. Issues group by procedure and error code. Events use a fixed `pcobooster-api` distinct ID without a person profile. Production only; the capture is awaited before the response is sent, bounded by a 1.5-second timeout.
- **iPhone app:** JavaScript fatals (from startup on), uncaught errors, unhandled rejections, render errors, and terminal API failures, under the "Share usage analytics and error reports" switch, never in demo, with release and source revision on every event and Hermes source maps uploaded per build. API 5xx failures are `api request failed` events joined to the Worker's `rpc` line by `request_id` rather than a second `$exception`. See [Mobile diagnostics](mobile-diagnostics.md).
- **Browser:** exception autocapture (unhandled errors and promise rejections, not console errors) covers authenticated Services, People, and Songs routes, including Overview. Its gate is independent of replay, so recording eligibility and sampling remain unchanged. Errors React catches in an error boundary are reported from `onCaughtError` in `apps/web/src/client.tsx`. The QueryCache reports every terminal failed query once after automatic retries, including unobserved background queries, 4xx errors, and rejected aborts. Its synthetic `DataLoadError` carries a safe query family and error code, never query IDs, provider messages, or bodies; SDK identity and session properties link it to the affected person. Unknown query families use `unknown-read`. The privacy guard drops `$exception` elsewhere and keeps type, message (truncated), mechanism, and stack frames plus allowlisted diagnostic properties; frame URLs outside `/assets/` are scrubbed like page URLs, and source context lines are dropped.

## Erasing deleted accounts

Deleting an account (`DELETE /api/v1/user`) queues a row in `analytics_erasure_requests` in the same D1 batch, so the erasure owed to PostHog can't be lost. `packages/api/src/modules/account-deletion/analytics-erasure.ts` carries it out: it calls PostHog's `persons/bulk_delete` with the user id as distinct id and `delete_events` and `delete_recordings`, twice per account:

1. No sooner than one hour after the deletion, so captures already in flight (a feedback forward, a phone's queued events) have landed. PostHog only deletes events captured before each request.
2. No sooner than seven days after it, to catch late arrivals.

A failed pass is retried with backoff (15 minutes, doubling, at most a day) and never skipped; updates are conditional on the pass count, so overlapping runs never double-advance a request. After the second accepted pass the distinct id is cleared and the row stays as a receipt with no personal data. "Completed" means PostHog accepted both requests; PostHog removes events in the background during off-peak hours (weekends on PostHog Cloud), so check `deletion_status` in PostHog if you need to confirm storage is clean.

### Schedule

The production API Worker runs the queue from a Cron Trigger (`17 * * * *`, hourly, UTC; `apps/server/src/analytics-erasure-schedule.ts`), declared with `Cloudflare.Workers.cron` in `apps/server/src/worker.ts`. It reads D1 through the Worker's own binding, so no D1 API token exists in the Worker. Each run handles at most 25 due requests (inside the 80-subrequest limit) and logs counts only (`module: analytics-erasure`, message `Analytics erasure run`) in Workers Logs. Previews, staging, local, and tests declare no cron and read no erasure key.

Overlapping runs (a slow hour, or an operator's manual run) are safe: every update is conditional on the pass count it read, and PostHog treats a repeated deletion as done.

Failures alert through production's existing PostHog error tracking: each run that needs a person sends one `$exception` per problem with `path` `cron:analytics-erasure` and an `error_code` of:

- `ANALYTICS_ERASURE_PASS_FAILED`: PostHog refused or was unreachable for at least one pass (rescheduled with backoff).
- `ANALYTICS_ERASURE_OVERDUE`: a request is still open nine days after its deletion (the confirmation pass is due at seven). The privacy policy promises two weeks, so treat it as an incident.
- `ANALYTICS_ERASURE_RUN_FAILED`: D1 or the queue itself failed. No row details are logged or reported.
- `ANALYTICS_ERASURE_NOT_CONFIGURED`: the erasure key is unreadable or empty.

A cron that never fires sends nothing; the Worker's Cron Triggers and past events are listed under the Worker's Settings → Triggers in the Cloudflare dashboard, and `bun run analytics:erase` shows the queue's counts.

Prerequisite: `POSTHOG_ERASURE_API_KEY`, a PostHog personal API key limited to **person:write** on project 614621, kept in Infisical `pcobooster-prod` (env `prod`) and stored as `pcobooster__prod__analytics__POSTHOG_ERASURE_API_KEY` by `alchemy.secrets.ts` (production tier only). The stored secret must exist before the API Worker that consumes it deploys, and an empty value surfaces as `ANALYTICS_ERASURE_NOT_CONFIGURED`; see [rollout](ci-cd.md#analytics-erasure-cron).

### Inspecting or running by hand

```sh
bun run analytics:erase -- --database-id <production D1 UUID>            # counts only
bun run analytics:erase -- --database-id <production D1 UUID> --process  # erase what is due
```

`scripts/analytics/erase-deleted-accounts.ts` runs the same code over the D1 HTTP API. It prints counts only (waiting, due, failing, completed, oldest open request), never ids, and exits 1 when a pass failed. It is optional: the cron does the work. It needs the operator's `analytics-erasure` Keychain scope (`bun run secrets:set analytics-erasure <KEY> --stdin`): `CLOUDFLARE_D1_API_TOKEN` (limited to **D1 Edit**; required) and `POSTHOG_ERASURE_API_KEY` (for `--process`; a local copy of the Infisical value, which the cron never reads), plus the production D1 database id (the `databaseId` output of the production stack).

## Privacy and cost boundaries

- No marketing, auth, or demo recordings. No heatmaps, automatic click/form capture, rage clicks, console logs, surveys, web experiments, or web-vitals capture. Exception capture is limited to authenticated product routes (see [Error tracking](#error-tracking)).
- PostHog feature flag evaluation is disabled. The web app fetches PostHog remote configuration and the recorder asset for replay; marketing disables both external dependency loading and remote configuration.
- Analytics event names and property keys are allowlisted. Replay snapshots are separately accepted only on authenticated product routes; rrweb masks their contents before transmission. Both ordinary event properties and the SDK's top-level person `$set`/`$set_once` fields are scrubbed in the browser; only the server sets identifying person properties.
- URLs lose queries/fragments; external referrers retain only their origin. Product URLs use route placeholders for plan, service-type, and person IDs. Unknown and private routes become `/other`; demo-entry events are rejected entirely.
- Campaign attribution retains `utm_source`, `utm_medium`, and `utm_campaign`. Do not put personal information in campaign labels.
- The SDK honors Do Not Track. Sign-out stops recording before resetting analytics identity. Analytics errors never block app operations.
- Collection requires a production build, the production key, and the exact hostname `pcobooster.com`. Local, preview, presentation, and demo traffic do not enter the production charts.
- PostHog's [documented free allowance](https://posthog.com/docs/product-analytics/pricing) is 1 million analytics events/month as of September 23, 2026. Pageviews, pageleaves, identification, and explicit events contribute to usage. No billing upgrade is enabled. Replay has a separate free allowance and usage counter described below. Billing permissions are separate from the connector; confirm the account's spending limit in PostHog Billing before enabling paid overages.

## Web-app session replay

[Recordings](https://us.posthog.com/project/614621/replay) start only after a successful non-demo account response on `/services`, `/people`, or their supported detail routes. Overview remains outside the existing replay route gate; its errors are captured independently. The SDK starts with recording disabled even on auth pages, then uses `startSessionRecording()` without sampling overrides. Marketing is a separate document and never starts replay. Sign-out and demo access stop the recorder; the outbound snapshot guard independently rejects marketing, auth, demo, and unknown routes.

Project controls: **100% of eligible sessions** during launch hypercare (20% before), **10-second minimum duration**, **30-day retention**, and only the `https://pcobooster.com` origin. Sampling and minimum duration are project settings in `reports.ts`; change them there and run `bun run posthog:deploy` (no app redeploy needed). An edit in PostHog's replay settings is overwritten by the next deploy. Sampling is probabilistic, not a spending cap. PostHog currently includes [5,000 web recordings/month free](https://posthog.com/session-replay/pricing); the account's billing cap remains unverified.

Replay masks all page text and inputs, blocks media/iframes, removes document metadata, and retains only class/type/role DOM attributes. Names, labels, values, URLs, and data attributes are therefore hidden, which intentionally reduces replay detail. Navigation URLs are normalized with the same route scrubber as analytics. Console, network bodies/headers/performance, canvas, cross-origin frames, and JSON-LD capture remain disabled. These controls follow [PostHog replay privacy guidance](https://posthog.com/docs/session-replay/privacy).

## Configuration and release

The public ingestion key is committed in `packages/config/src/public-environment.ts` for deployed web/API configuration and in the mobile release rules for archive validation. It is not a personal API key. The application stack binds it and inlines it only in production. The Alchemy build stamp hashes it so rotations rebuild the prerendered marketing assets. Change both public constants in a reviewed commit if it rotates.

### Same-origin browser proxy

The shared browser client uses `api_host: "/ingest"` and `ui_host: "https://us.posthog.com"`. The product Worker's public `/ingest/*` server route forwards ingestion and replay to `https://us.i.posthog.com`; `/ingest/static/*` and `/ingest/array/*` go to `https://us-assets.i.posthog.com` for SDK assets and remote configuration, following [PostHog's Cloudflare proxy guidance](https://posthog.com/docs/advanced/proxy/cloudflare). Marketing is prerendered into the same Worker's assets and served on `pcobooster.com`, so its shared client uses this route too. Separate local marketing development stays outside production collection.

The request gate admits this path signed out, after Start's server-function-only CSRF guard. The proxy forwards only content negotiation, content encoding/type, user agent, and conditional asset headers. Cookies, authorization, Cloudflare Access tokens, account headers, and referrer headers never reach PostHog. Cloudflare's `CF-Connecting-IP` becomes `X-Forwarded-For` for geo; incoming forwarded-IP chains are ignored. The upstream hosts are fixed, redirects are not followed, upstream cookies are dropped, dynamic responses are `no-store`, and asset cache headers are preserved. Encoded POST bodies are buffered without transforming them; upstream requests have a 15-second timeout.

This removes the direct third-party ingestion URL from browser requests, reducing ad-blocker loss; delivery is still best effort and consent, Do Not Track, identity, demo, and replay privacy gates are unchanged. Each proxy request uses the product Worker's request/subrequest allowance, independently of the API's Planning Center budget. The API's server captures and iPhone app still send directly to PostHog.

A production deployment is required after changing the proxy or key. Removing the PostHog key and redeploying disables SDK/API capture; the public forwarding route remains reachable.

After deployment, open marketing, follow Open app, sign in, and navigate the product. In the browser network panel, confirm ingestion, replay, remote config, and recorder requests use `/ingest/*`, with no sign-in redirect; verify PostHog geo reflects the visitor rather than a Cloudflare data center. In PostHog's live events, confirm marketing/auth/app pageviews share the expected merged identity and `app opened` appears once per document. Confirm recordings appear only for sampled authenticated app sessions, and that marketing/auth/demo remain unrecorded. Check masked replay content and the absence of feature flag requests. Inspect property payloads for scrubbed URLs. Use only read-only product navigation for verification; verify writes through synthetic tests rather than changing live Planning Center data.

Implementation follows the [TanStack Start integration](https://posthog.com/docs/libraries/tanstack-start) without its provider, since `@pcobooster/analytics` owns initialization, plus the [SDK configuration reference](https://posthog.com/docs/libraries/js/config), and [guidance on reducing unwanted events](https://posthog.com/tutorials/fewer-unwanted-events).
