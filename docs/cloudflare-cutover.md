# Cloudflare cutover record

Production moved to Cloudflare on September 23, 2026. The deployed application revision is `2ebddfbc8122ee1b5fbbd653df110a5c71f1a6ad`; subsequent documentation commits do not change its bundles.

## Live resources

- `pcobooster.com` and `www.pcobooster.com`: `pcobooster-prod-web` (www redirects to the canonical origin).
- `admin.pcobooster.com`: `pcobooster-prod-admin`.
- Private service binding: `pcobooster-prod-api`.
- Retained D1 database: `pcobooster-prod`, ID `781f72d7-22ad-4ece-a41d-e71ac4b6b427`.
- Cloudflare zone: `a43fafd2bb6e6fb47f0233e6168e622e`, nameservers `aaron.ns.cloudflare.com` and `pam.ns.cloudflare.com`.
- Production GitHub environment has `CLOUDFLARE_CUSTOM_DOMAINS=1`; preserve it for subsequent deployments.
- Former domain: `worshipadmin.com` and `www.worshipadmin.com` (the product's name until the September 18 rename) redirect to `https://pcobooster.com` with HTTP 308, preserving paths and query strings. Vercel serves the redirect (nameservers `ns1`/`ns2.vercel-dns.com`); see [former domain](#former-domain). Registration stays with Name.com through Vercel and expires February 28, 2027; renew or transfer it before then.

## Data preservation

Both Vercel projects were frozen across all deployment URLs before migration. No source database writers or local app servers remained; a five-minute drain covered the source Hobby function duration limit. The importer then used a read-only PostgreSQL snapshot and verified D1 row counts, normalized SHA-256 hashes, and foreign keys. A second fresh source snapshot reconciled identically before custom domains were attached.

| Table                              | Rows |
| ---------------------------------- | ---: |
| user                               |    9 |
| account                            |   10 |
| session                            |   29 |
| verification                       |    0 |
| planning_center_account_identities |    8 |
| activity_events                    |  116 |

The original Better Auth signing secret and cookie scope were preserved. Browser verification after cutover loaded the authenticated Services page and Planning Center plans using an existing session; the admin Accounts page showed all nine users and retained login history. Anonymous homepage, auth, and session requests returned HTTP 200. These checks do not establish fresh OAuth sign-in or preview OAuth coverage.

## DNS propagation bridge

Cloudflare custom domains were attached at 22:22 UTC. Public resolvers returned Cloudflare addresses, but cached local DNS continued sending requests to Vercel, where the migration freeze returned 403. To restore those requests without resuming Neon writes, both Vercel projects received a first-position, all-path external rewrite to their corresponding Cloudflare workers.dev origin. Only after publishing the rewrites were the temporary freeze rules disabled.

- Product route: `c63639fd-fa2b-4f3d-addd-3b3a58bf97e9`.
- Admin route: `c5167b18-ee33-4a02-86ca-b243de6a6a3d`.
- Source pattern: `/:path*`; destination ends in `/:path` (a destination `*` was forwarded literally by the project routing API).
- Responses use `Cache-Control: private, no-store`.
- Product freeze rule: `rule_cloudflare_migration_freeze_oJacbj`.
- Admin freeze rule: `rule_cloudflare_migration_freeze_thQyrQ`.

Do not remove these rewrites while the old runtime can receive traffic. After DNS propagation is verified, re-enable the freeze rules before disabling the bridges, or keep the bridges until the legacy projects are retired. Preserve existing Vercel deployment protection. Never re-enable the legacy application's Neon write path as a casual rollback: D1 now accepts application writes.

Both Vercel projects have been disconnected from GitHub to stop automatic legacy deployments. Independent checks verified nested paths and encoded/duplicate query values through the bridge, anonymous session rejection, admin API HTTP 401, and Cloudflare execution for old immutable deployment URLs. Some cached admin requests still encounter Vercel's existing SSO protection before forwarding; direct Cloudflare requests use the app's own auth boundary.

## Former domain

The `prod` stage once declared a Cloudflare replacement for the Vercel redirect: a hand-created `worshipadmin.com` zone with a Single Redirect rule, waiting for the nameservers to move from Vercel. They never moved, Cloudflare deleted the pending zone around October 22, 2026, and every production deploy then stopped on the missing zone. The declaration was removed; `git log -S formerDomainRedirect` finds it. To move the redirect to Cloudflare later, restore it, create the zone by hand, grant the production deploy token the zone with `bun run infra:deploy`, and change the nameservers within a few days, before Cloudflare deletes the pending zone again.

## Remaining external verification

GitHub OIDC deployment and cleanup still need an approved workflow run. The protected environments require Jake's approval for every deployment. Replace the legacy required Vercel check only after the migration PR's `cloudflare-build` check succeeds; preserve the no-bypass policy.

Neon, Vercel projects, and legacy secrets remain retained. Their deletion is a separate decision.

## Registrar transfer

DNS is hosted by Cloudflare. Registration remains with Name.com through Vercel because the domain was registered September 18, 2026 and is within its 60-day transfer lock. The earliest transfer time is November 17, 2026 at 19:52:51 UTC (11:52 AM Pacific). Do not describe the registrar migration as complete or delete the registrar project while registration remains there.
