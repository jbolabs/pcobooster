/**
 * Cloudflare deploy-token lifecycle for the CI stack.
 *
 * Minting account API tokens needs `Account API Tokens Write`, which neither Alchemy's OAuth login
 * nor the deploy tokens hold. Rather than running the whole stack (including the shared state
 * store) with a token-administration credential, only `AccountApiToken` calls use
 * `CLOUDFLARE_TOKEN_ADMIN_API_TOKEN`. Everything else keeps the user's Alchemy profile.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Provider from "alchemy/Provider";
import type { Redacted } from "effect";
import { Config, Effect, Layer, Option } from "effect";

export const tokenAdminVariable = "CLOUDFLARE_TOKEN_ADMIN_API_TOKEN";

const cloudflareApiUrl = "https://api.cloudflare.com/client/v4";

const tokenAdmin = Config.option(Config.Redacted(tokenAdminVariable));

const missingTokenAdmin = new Error(
  `${tokenAdminVariable} is not set. Creating, updating, reading, or revoking Cloudflare deploy ` +
    "tokens needs an account API token with Account API Tokens Write; see docs/ci-cd.md."
);

const adminCredentials = (token: Redacted.Redacted) =>
  Effect.succeed({
    type: "apiToken" as const,
    apiToken: token,
    apiBaseUrl: cloudflareApiUrl,
  });

/** Run a token API call as the token administrator, or explain what is missing. */
const asTokenAdmin = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  tokenAdmin.pipe(
    Effect.orDie,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.die(missingTokenAdmin),
        onSome: (token) =>
          Effect.provideService(
            effect,
            Cloudflare.Credentials,
            adminCredentials(token)
          ),
      })
    )
  );

type AccountApiToken = Cloudflare.ApiToken.AccountApiToken;

/**
 * Alchemy's AccountApiToken provider with token-admin credentials. A plan that finds no admin
 * credential trusts the stored token state instead of failing, so `--detect-drift` still works
 * for everything else; applying a token change always needs the credential.
 */
export const accountApiTokenProvider = () =>
  Provider.effect(
    Cloudflare.ApiToken.AccountApiToken,
    Effect.gen(function* tokenAdminLifecycle() {
      const base = yield* Provider.Provider<AccountApiToken>(
        Cloudflare.ApiToken.AccountApiToken.Type
      );
      return {
        ...base,
        read: (input: Parameters<NonNullable<typeof base.read>>[0]) =>
          tokenAdmin.pipe(
            Effect.orDie,
            Effect.flatMap((admin) =>
              Option.isNone(admin) || base.read === undefined
                ? Effect.succeed(input.output)
                : asTokenAdmin(base.read(input))
            )
          ),
        reconcile: (input: Parameters<typeof base.reconcile>[0]) =>
          asTokenAdmin(base.reconcile(input)),
        delete: (input: Parameters<typeof base.delete>[0]) =>
          asTokenAdmin(base.delete(input)),
      };
    })
  ).pipe(Layer.provide(Cloudflare.ApiToken.AccountApiTokenProvider()));
