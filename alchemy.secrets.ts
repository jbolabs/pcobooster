/** Retained, centrally owned runtime secrets. Product deployments only reference these resources. */
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Config, Effect, Redacted } from "effect";

import {
  runtimeSecretPurpose,
  storedRuntimeKeys,
  storeSecretName,
} from "./scripts/secrets/manifest";
import { stageSecrets } from "./stacks/secrets";

export default Alchemy.Stack(
  "pcobooster-secrets",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
    // Inputs come from Infisical `pcobooster-prod` (env `prod` or `preview`). The operator runs this
    // stack with `--profile admin` (the `operator` identity plus Cloudflare); agents cannot read it.
    secrets: stageSecrets(["prod", "preview"]),
  },
  Effect.gen(function* runtimeSecrets() {
    const stage = yield* Alchemy.Stage;
    if (stage !== "prod" && stage !== "preview") {
      return yield* Effect.die(
        new Error("Runtime secrets use --stage prod or --stage preview")
      );
    }
    const store = yield* Cloudflare.SecretsStore.Store("AccountSecrets");
    for (const key of storedRuntimeKeys(stage === "prod")) {
      yield* Cloudflare.SecretsStore.Secret(key, {
        store,
        name: storeSecretName(
          "pcobooster",
          stage,
          runtimeSecretPurpose(key),
          key
        ),
        // The demo remains optional. Empty stored values preserve its disabled behavior.
        value: yield* key.startsWith("DEMO_")
          ? Config.Redacted(key).pipe(Config.withDefault(Redacted.make("")))
          : Config.Redacted(key),
        comment: `Owned by pcobooster-secrets/${stage}; rotate through this stack.`,
      }).pipe(RemovalPolicy.retain());
    }
    return { storeId: store.storeId };
  })
);
