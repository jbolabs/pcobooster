# Database

The app uses Drizzle with Cloudflare D1 (SQLite). `apps/server/src/database.ts` declares one database per stage, and the API Worker binds it through `Cloudflare.D1.QueryDatabase`; no connection string is used at runtime. Better Auth uses the SQLite adapter with transactions disabled because D1's HTTP driver does not support interactive transactions.

## Schema changes

Edit `packages/api/src/db/schema.ts`, then run `bun run dev` (or `bun run db:generate`). `apps/server/src/database.ts` declares the schema as a `Drizzle.Schema` resource, so every deploy, local startup included, generates a migration when the schema has drifted and the `Database` resource applies it. Review and commit the generated `packages/api/migrations/<timestamp>_<name>/` directory; a test fails CI while any schema change lacks its committed migration. drizzle-kit names migrations randomly unless told otherwise, so prefer generating them yourself with a descriptive name before starting the dev stack: `bun run --cwd packages/api db:generate --name add_feedback_table`. Changes drizzle-kit must ask about (renames, possible data loss) fail non-interactive deploys: run `bun run db:generate` in a terminal to answer them, then commit the result.

Alchemy records each applied migration by directory name and SQL hash in `__alchemy_migrations`, and refuses to deploy when an applied migration was renamed, edited, or deleted (`RewrittenMigrationHistoryError`). Migration directories are append-only: to change the schema again, add a new migration. `scripts/database/migration-history.test.ts` fails a PR that renames, edits, or deletes a migration already on `main`, and applies every migration to a fresh D1 database with the stock Alchemy applier. If a deployed database's history ever has to change (for example after a layout conversion), convert its `__alchemy_migrations` rows once to match the committed files, the way Alchemy adopts drizzle-kit and wrangler histories, after checking each row's hash against the file it maps to; never patch Alchemy to accept other names. Production went through this once on 2026-10-19: two rows left over from the pre-v1 flat layout, already duplicated by their directory-named rows, were removed.

Declare unique constraints with named `uniqueIndex(...)`s, not `.unique()`. drizzle-kit renders `.unique()` inline, and adding one to an existing table rebuilds it; on D1 that means dropping a parent table, which cascades to its children.

### Migrations must keep the running app online

Alchemy applies migrations while updating the `Database` resource. The API Worker declares the database in its deployment props as well as its runtime query binding, so Alchemy must finish migration reconciliation before it can upload the API. A runtime-only binding does not establish this deployment dependency. During that gap, the previous Worker version is still serving requests against the new schema. A failed deploy after that point does not roll back SQL that was already committed. Every migration must therefore work with the code that is currently deployed:

- Expand, then contract. Add new tables and nullable or defaulted columns first. Ship the code that uses them. Remove the old columns in a later PR, once no deployed code reads them.
- Never rename a column or table in place, and never drop one that the deployed code still reads.
- Backfills must be safe to repeat, and small enough for D1's per-query limits.

If a change can't be made online, stop and explain the blocker before deploying. Don't reach for downtime.

Dates are integer milliseconds, booleans are integers, and JSON is text. Use Drizzle query builders or `db.all(sql`...`)` for reports. Integration tests run the real SQLite/D1 implementation under workerd.

## PostgreSQL preservation and cutover

The original schema/migrations are archived in `packages/api/migrations-postgres` solely for the one-time transfer. `pg` remains a development dependency for that tool. The app no longer reads PostgreSQL.

`bun run db:rehearse` takes a repeatable-read, read-only snapshot of the Keychain recovery scope's legacy `DATABASE_URL` and imports into disposable local D1. It preserves users, provider accounts/tokens, sessions, verification data, Planning Center identities, and activity history. Every table must match by count and SHA-256; foreign keys must pass. Identical partial imports resume safely, while differing or extra destination rows fail before any writes.

For the final remote transfer, freeze every old Vercel ingress (including immutable URLs/previews and GET OAuth callbacks), stop other writers, drain in-flight requests, then run `scripts/database/migrate-from-postgres.ts --database-id <verified D1 UUID>` with credentials injected into the process. Never print source rows or tokens. Save the count/hash receipt. Preserve production `BETTER_AUTH_SECRET` and cookie scope so signed sessions remain valid.

Production D1 has a retain policy. Before D1 receives new application writes, rollback can restore Vercel ingress/DNS. After new D1 writes, routing back to Neon would lose those changes: freeze both systems and reconcile first. Retain Neon until post-cutover verification is complete; deletion is a separate decision.
