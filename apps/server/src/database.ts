import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Effect } from "effect";

/**
 * One D1 database per stage. `Drizzle.Schema` regenerates migration SQL when the schema drifts,
 * and the database applies pending migrations on deploy.
 */
export const Database = Effect.gen(function* database() {
  const { stage } = yield* Alchemy.Stack;
  const schema = yield* Drizzle.Schema("Schema", {
    schema: "./packages/api/src/db/schema.ts",
    out: "./packages/api/migrations",
    dialect: "sqlite",
  });
  return yield* Cloudflare.D1.Database("Database", {
    name: `pcobooster-${stage}`,
    primaryLocationHint: "wnam",
    migrations: schema,
  }).pipe(RemovalPolicy.retain(stage === "prod" || stage === "staging"));
});
