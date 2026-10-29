import { Resource } from "alchemy";
import { CloudflareEnvironment } from "alchemy/Cloudflare";
import { havePropsChanged, isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Effect, Option, Redacted, Schema } from "effect";

import { trialBranch } from "./settings";

export interface TrialBuildsProps {
  readonly name?: string;
  readonly branches?: readonly string[];
  readonly buildCommand?: string;
  readonly deployCommand?: string;
  readonly workerTag: string;
  readonly buildCaching: boolean;
  readonly tokenId: string;
  readonly token: Redacted.Redacted;
  readonly variables: Readonly<Record<string, string | Redacted.Redacted>>;
}
interface Attributes {
  readonly workerTag: string;
  readonly triggerId: string;
  readonly buildTokenId: string;
  readonly name?: string;
}
type TrialBuildsResource = Resource<
  "PCOBooster.TrialBuilds",
  TrialBuildsProps,
  Attributes
>;
export const TrialBuilds = Resource<TrialBuildsResource>(
  "PCOBooster.TrialBuilds"
);

const envelope = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Unknown,
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ code: Schema.Number, message: Schema.String }))
  ),
});
const tokenSchema = Schema.Struct({
  build_token_uuid: Schema.String,
  build_token_name: Schema.String,
});
const triggerSchema = Schema.Struct({
  trigger_uuid: Schema.String,
  trigger_name: Schema.String,
});
const connectionSchema = Schema.Struct({ repo_connection_uuid: Schema.String });
const defaultTokenName = "pcobooster-builds-trial";

/** Decode failures never include API response bodies, which can contain build secrets. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the schema decoder at the external JSON boundary; failed values must never enter diagnostics.
const decode = <A>(schema: Schema.Codec<A>, value: unknown): A => {
  const result = Schema.decodeUnknownOption(schema)(value);
  if (Option.isNone(result)) {
    throw new Error("Unexpected Workers Builds response shape");
  }
  return result.value;
};

export const trialBuildsProvider = Provider.effect(
  TrialBuilds,
  Effect.gen(function* provider() {
    const credentials = yield* yield* CloudflareEnvironment;
    const headers = new Headers({
      "Content-Type": "application/json",
    });
    if (credentials.type === "apiKey") {
      headers.set("X-Auth-Key", Redacted.value(credentials.apiKey));
      headers.set("X-Auth-Email", Redacted.value(credentials.email));
    } else {
      headers.set(
        "Authorization",
        `Bearer ${Redacted.value(credentials.type === "apiToken" ? credentials.apiToken : credentials.accessToken)}`
      );
    }
    const request = (method: string, endpoint: string, body?: Schema.Json) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/builds/${endpoint}`,
            {
              method,
              headers,
              body: body === undefined ? undefined : JSON.stringify(body),
            }
          );
          const parsed = decode(envelope, await response.json());
          if (!response.ok || !parsed.success) {
            throw new Error(
              `Workers Builds ${method} ${endpoint}: HTTP ${response.status}, codes ${parsed.errors?.map((e) => `${e.code}: ${e.message}`).join(",") ?? "unknown"}`
            );
          }
          return parsed.result;
        },
        catch: (error) =>
          new Error(
            error instanceof Error
              ? error.message
              : "Workers Builds request failed"
          ),
      });
    const readTriggers = (workerTag: string) =>
      request("GET", `workers/${workerTag}/triggers`).pipe(
        Effect.map((value) => decode(Schema.Array(triggerSchema), value))
      );
    return {
      stables: ["workerTag", "triggerId", "buildTokenId"],
      read: ({ output }) =>
        output === undefined
          ? Effect.succeed(output)
          : readTriggers(output.workerTag).pipe(
              Effect.map((triggers) =>
                triggers.some(
                  (trigger) => trigger.trigger_uuid === output.triggerId
                )
                  ? output
                  : undefined
              )
            ),
      diff: ({ news, olds, output }) =>
        Effect.succeed(
          !isResolved(news) ||
            output === undefined ||
            havePropsChanged(olds, news)
            ? { action: "update" as const }
            : { action: "noop" as const }
        ),
      reconcile: ({ news, output }) =>
        Effect.gen(function* reconcile() {
          if (output && output.workerTag !== news.workerTag) {
            throw new Error(
              "Trial Worker replacement requires explicit teardown first"
            );
          }
          const tokenName = news.name ?? "pcobooster-builds-trial";
          const tokens = decode(
            Schema.Array(tokenSchema),
            yield* request("GET", "tokens")
          );
          let buildTokenId =
            output?.buildTokenId ??
            tokens.find((token) => token.build_token_name === tokenName)
              ?.build_token_uuid;
          buildTokenId ??= decode(
            tokenSchema,
            yield* request("POST", "tokens", {
              build_token_name: tokenName,
              build_token_secret: Redacted.value(news.token),
              cloudflare_token_id: news.tokenId,
            })
          ).build_token_uuid;
          // Connections are shared across a repository and are deliberately never deleted here.
          const connection = decode(
            connectionSchema,
            yield* request("PUT", "repos/connections", {
              provider_type: "github",
              provider_account_id: "305914027",
              provider_account_name: "jbolabs",
              repo_id: "1125110564",
              repo_name: "pcobooster",
            })
          );
          const triggers = yield* readTriggers(news.workerTag);
          const existing =
            output?.triggerId ??
            triggers.find((trigger) => trigger.trigger_name === tokenName)
              ?.trigger_uuid;
          const body = {
            trigger_name: tokenName,
            branch_includes: [...(news.branches ?? [trialBranch])],
            branch_excludes: [],
            build_command:
              news.buildCommand ??
              "bun scripts/cloudflare/builds-trial/run.ts check",
            deploy_command:
              news.deployCommand ??
              "bun scripts/cloudflare/builds-trial/run.ts deploy",
            build_token_uuid: buildTokenId,
            external_script_id: news.workerTag,
            repo_connection_uuid: connection.repo_connection_uuid,
            root_directory: "/",
            path_includes: ["*"],
            path_excludes: [],
            build_caching_enabled: news.buildCaching,
          };
          const trigger = decode(
            triggerSchema,
            yield* request(
              existing === undefined ? "POST" : "PATCH",
              existing === undefined ? "triggers" : `triggers/${existing}`,
              body
            )
          );
          yield* request(
            "PATCH",
            `triggers/${trigger.trigger_uuid}/environment_variables`,
            Object.fromEntries(
              Object.entries(news.variables).map(([key, value]) => [
                key,
                {
                  value: Redacted.isRedacted(value)
                    ? Redacted.value(value)
                    : value,
                  is_secret: Redacted.isRedacted(value),
                },
              ])
            )
          );
          return {
            name: tokenName,
            workerTag: news.workerTag,
            triggerId: trigger.trigger_uuid,
            buildTokenId,
          };
        }),
      delete: ({ output }) =>
        Effect.gen(function* remove() {
          const triggers = yield* readTriggers(output.workerTag);
          if (
            triggers.some(
              (trigger) => trigger.trigger_uuid === output.triggerId
            )
          ) {
            yield* request("DELETE", `triggers/${output.triggerId}`);
          }
          const tokens = decode(
            Schema.Array(tokenSchema),
            yield* request("GET", "tokens")
          );
          if (
            tokens.some(
              (token) =>
                token.build_token_uuid === output.buildTokenId &&
                token.build_token_name === (output.name ?? defaultTokenName)
            )
          ) {
            yield* request("DELETE", `tokens/${output.buildTokenId}`);
          }
        }),
    };
  })
);
