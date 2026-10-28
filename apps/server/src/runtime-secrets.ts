import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { Config, Effect, Redacted } from "effect";

import type { RuntimeSecretKey } from "../../../scripts/secrets/manifest";
import { currentStageSettings } from "./stage";

/** Local values come from Keychain; deployed consumers never declare or overwrite stored values. */
export const readRuntimeSecret = Effect.fn("readRuntimeSecret")(
  function* readRuntimeSecret(key: RuntimeSecretKey) {
    const { local, production } = yield* currentStageSettings;
    if (local) {
      const value = yield* Config.Redacted(key);
      return Effect.succeed(Redacted.value(value));
    }
    const secret = yield* Cloudflare.SecretsStore.Secret.ref(key, {
      stack: "pcobooster-secrets",
      stage: production ? "prod" : "preview",
    });
    const binding = yield* Cloudflare.SecretsStore.ReadSecret(secret);
    return binding.pipe(Effect.map(Redacted.value));
  }
);

/** Generated preview signing keys remain disposable and isolated to their own stage. */
export const readAuthSecret = Effect.gen(function* readAuthSecret() {
  const { local, production } = yield* currentStageSettings;
  return local || production
    ? yield* readRuntimeSecret("BETTER_AUTH_SECRET")
    : (yield* (yield* Alchemy.Random("BetterAuthSecret")).text).pipe(
        Effect.map(Redacted.value)
      );
});
