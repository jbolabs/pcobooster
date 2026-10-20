import { Config, Effect, Redacted, Schema } from "effect";

const identitySchema = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    attributes: Schema.Struct({ name: Schema.String }),
  }),
});

const optional = (key: string) =>
  Config.Redacted(key).pipe(Config.map(Redacted.value), Config.withDefault(""));

/**
 * Stage `local` with the personal access token bypass: refuse to start without a token, and when
 * the launcher pinned an organization (`DEV_PLANNING_CENTER_ORGANIZATION`), without a token that
 * belongs to it. This runs in the stack because the token may come from Infisical, which only
 * Alchemy reads. The identity probe is GET-only.
 */
export const verifyDevelopmentOrganization = Effect.gen(
  function* verifyDevelopmentOrganization() {
    const bypass = yield* Config.String("DEV_AUTH_BYPASS").pipe(
      Config.withDefault("")
    );
    if (bypass !== "1") {
      return;
    }
    const client = yield* optional("PLANNING_CENTER_CLIENT");
    const token = yield* optional("PLANNING_CENTER_PAT");
    if (client === "" || token === "") {
      yield* Effect.die(
        new Error(
          "The personal access token sign-in needs PLANNING_CENTER_CLIENT and PLANNING_CENTER_PAT. Check that the Alchemy profile reads Infisical pcobooster-dev (bun run setup:infisical), or run bun run dev:auth to sign in through Planning Center OAuth."
        )
      );
    }
    const expected = yield* Config.String(
      "DEV_PLANNING_CENTER_ORGANIZATION"
    ).pipe(Config.withDefault(""));
    if (expected === "") {
      return;
    }
    const identity = yield* Effect.tryPromise(async () => {
      const response = await fetch(
        "https://api.planningcenteronline.com/services/v2",
        {
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Basic ${Buffer.from(`${client}:${token}`).toString("base64")}`,
          },
        }
      );
      if (!response.ok) {
        throw new Error(
          `Planning Center identity check failed: HTTP ${response.status}`
        );
      }
      return Schema.decodeUnknownSync(identitySchema)(await response.json());
    }).pipe(Effect.orDie);
    if (identity.data.id !== expected) {
      yield* Effect.die(
        new Error(
          `The Planning Center token belongs to organization ${identity.data.id}, not the pinned ${expected}.`
        )
      );
    }
  }
);
