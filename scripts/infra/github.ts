import * as GitHub from "@alchemy.run/github";
/**
 * GitHub pieces of the CI control plane that `@alchemy.run/github` does not cover on its own.
 *
 * - `GitHubRuleset` manages a repository ruleset with GitHub's own rule payloads. Alchemy's
 *   `GitHub.Ruleset` cannot express merge queues or allowed merge methods, and it cannot find an
 *   existing ruleset without prior state, so it would create a second ruleset beside the live
 *   one. This resource finds the live ruleset by name, and the stack adopts it explicitly.
 * - `gitHubProviders` gives Alchemy's Repository, Environment, and Variable providers a `read`,
 *   so plans report existing objects as adopted rather than created and `--detect-drift` can see
 *   them. Their reconcile logic is unchanged: all three already upsert.
 */
import { Resource } from "alchemy";
import type { ResourceClassLike, ResourceLike } from "alchemy";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { sendJson, sendJsonRequired } from "./http";
import type { HttpMethod } from "./http";

const gitHubApiUrl = "https://api.github.com";

const gitHubRequest = (
  operation: string,
  method: HttpMethod,
  path: string,
  body?: Schema.Json
) =>
  Effect.gen(function* gitHubRequestWithToken() {
    const credentials = yield* yield* GitHub.GitHubCredentials;
    return {
      service: "GitHub",
      operation,
      method,
      url: `${gitHubApiUrl}${path}`,
      token: credentials.token,
      body,
      headers: {
        "user-agent": "pcobooster-ci-stack",
        "x-github-api-version": "2022-11-28",
      },
    };
  });

const repoPath = (owner: string, repository: string) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;

// ---------------------------------------------------------------------------------------------
// Ruleset: payload model and comparison (pure, unit-tested)
// ---------------------------------------------------------------------------------------------

/**
 * The ruleset fields this stack enforces, in GitHub's payload shape, so a declaration is also the
 * request body. Each rule is spelled exactly as GitHub's REST API spells it, for example
 * `{ type: "merge_queue", parameters }`.
 */
const RulesetSpecSchema = Schema.Struct({
  name: Schema.String,
  target: Schema.Literals(["branch", "push", "tag"]),
  enforcement: Schema.Literals(["active", "disabled", "evaluate"]),
  conditions: Schema.Struct({
    ref_name: Schema.Struct({
      include: Schema.Array(Schema.String),
      exclude: Schema.Array(Schema.String),
    }),
  }),
  bypass_actors: Schema.Array(
    Schema.Struct({
      actor_id: Schema.NullOr(Schema.Number),
      actor_type: Schema.String,
      bypass_mode: Schema.String,
    })
  ),
  rules: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      parameters: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
    })
  ),
});

export type RulesetSpec = typeof RulesetSpecSchema.Type;
export type RulesetRule = RulesetSpec["rules"][number];

export const RulesetReply = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  target: Schema.Literals(["branch", "push", "tag"]),
  enforcement: Schema.Literals(["active", "disabled", "evaluate"]),
  conditions: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        ref_name: Schema.optional(
          Schema.Struct({
            include: Schema.optional(Schema.Array(Schema.String)),
            exclude: Schema.optional(Schema.Array(Schema.String)),
          })
        ),
      })
    )
  ),
  bypass_actors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        actor_id: Schema.optional(Schema.NullOr(Schema.Number)),
        actor_type: Schema.String,
        bypass_mode: Schema.String,
      })
    )
  ),
  rules: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        parameters: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
      })
    )
  ),
});
const RulesetSummaries = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    source_type: Schema.optional(Schema.String),
  })
);

export type ObservedRuleset = RulesetSpec & { readonly rulesetId: number };

/** Normalize a GitHub reply; absent optional sections mean "none". */
export const toObservedRuleset = (
  reply: typeof RulesetReply.Type
): ObservedRuleset => ({
  rulesetId: reply.id,
  name: reply.name,
  target: reply.target,
  enforcement: reply.enforcement,
  conditions: {
    ref_name: {
      include: reply.conditions?.ref_name?.include ?? [],
      exclude: reply.conditions?.ref_name?.exclude ?? [],
    },
  },
  bypass_actors: (reply.bypass_actors ?? []).map((actor) => ({
    actor_id: actor.actor_id ?? null,
    actor_type: actor.actor_type,
    bypass_mode: actor.bypass_mode,
  })),
  rules: (reply.rules ?? []).map((rule) =>
    rule.parameters === undefined
      ? { type: rule.type }
      : { type: rule.type, parameters: rule.parameters }
  ),
});

const isJsonArray = (
  value: Schema.Json | undefined
): value is Schema.JsonArray => Array.isArray(value);

const isJsonObject = (
  value: Schema.Json | undefined
): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether `observed` enforces everything `desired` declares. Objects may carry extra keys GitHub
 * adds with defaults; arrays must hold the same members in any order.
 */
export const covers = (
  desired: Schema.Json,
  observed: Schema.Json | undefined
): boolean => {
  if (isJsonArray(desired)) {
    if (!isJsonArray(observed) || observed.length !== desired.length) {
      return false;
    }
    const unmatched = [...observed];
    return desired.every((item) => {
      const index = unmatched.findIndex((candidate) => covers(item, candidate));
      if (index === -1) {
        return false;
      }
      unmatched.splice(index, 1);
      return true;
    });
  }
  if (isJsonObject(desired)) {
    return (
      isJsonObject(observed) &&
      Object.entries(desired).every(([key, value]) =>
        covers(value, observed[key])
      )
    );
  }
  return Object.is(desired, observed);
};

/**
 * The declaration is authoritative for rule types: an extra live rule is drift. Within a rule,
 * parameters GitHub adds with default values are ignored.
 */
export const rulesetMatches = (
  desired: RulesetSpec,
  observed: RulesetSpec
): boolean =>
  desired.name === observed.name &&
  desired.target === observed.target &&
  desired.enforcement === observed.enforcement &&
  covers(desired.conditions, observed.conditions) &&
  covers(desired.bypass_actors, observed.bypass_actors) &&
  covers(desired.rules, observed.rules);

const specOf = (spec: RulesetSpec): RulesetSpec => ({
  name: spec.name,
  target: spec.target,
  enforcement: spec.enforcement,
  conditions: spec.conditions,
  bypass_actors: spec.bypass_actors,
  rules: spec.rules,
});

// ---------------------------------------------------------------------------------------------
// Ruleset resource
// ---------------------------------------------------------------------------------------------

export type GitHubRulesetProps = RulesetSpec & {
  readonly owner: string;
  readonly repository: string;
};

export type GitHubRulesetAttributes = ObservedRuleset & {
  readonly owner: string;
  readonly repository: string;
};

export type GitHubRulesetResource = Resource<
  "Pcobooster.GitHub.Ruleset",
  GitHubRulesetProps,
  GitHubRulesetAttributes
>;

/** Retained by default: dropping the declaration must never unprotect a branch. */
export const GitHubRuleset = Resource<GitHubRulesetResource>(
  "Pcobooster.GitHub.Ruleset",
  { defaultRemovalPolicy: "retain" }
);

const getRuleset = (owner: string, repository: string, rulesetId: number) =>
  gitHubRequest(
    `read ruleset ${rulesetId}`,
    "GET",
    `${repoPath(owner, repository)}/rulesets/${rulesetId}`
  ).pipe(
    Effect.flatMap((request) => sendJson(request, RulesetReply)),
    Effect.map(
      Option.map((reply): GitHubRulesetAttributes => ({
        owner,
        repository,
        ...toObservedRuleset(reply),
      }))
    )
  );

/** Repository-level rulesets only; organization rulesets are not ours to adopt. */
const findRulesetByName = Effect.fn("findRulesetByName")(
  function* findRulesetByName(props: GitHubRulesetProps) {
    const request = yield* gitHubRequest(
      `list rulesets for ${props.owner}/${props.repository}`,
      "GET",
      `${repoPath(props.owner, props.repository)}/rulesets?includes_parents=false&per_page=100`
    );
    const summaries = yield* sendJsonRequired(request, RulesetSummaries);
    const match = summaries.find(
      (summary) =>
        summary.name === props.name &&
        (summary.source_type ?? "Repository") === "Repository"
    );
    return match === undefined
      ? Option.none<GitHubRulesetAttributes>()
      : yield* getRuleset(props.owner, props.repository, match.id);
  }
);

const writeRuleset = (
  props: GitHubRulesetProps,
  existing: Option.Option<number>
) => {
  const target = Option.match(existing, {
    onNone: () => ({
      operation: `create ruleset ${props.name}`,
      method: "POST" as const,
      path: `${repoPath(props.owner, props.repository)}/rulesets`,
    }),
    onSome: (rulesetId) => ({
      operation: `update ruleset ${rulesetId}`,
      method: "PUT" as const,
      path: `${repoPath(props.owner, props.repository)}/rulesets/${rulesetId}`,
    }),
  });
  return gitHubRequest(
    target.operation,
    target.method,
    target.path,
    specOf(props)
  ).pipe(
    Effect.flatMap((request) => sendJsonRequired(request, RulesetReply)),
    Effect.map((reply): GitHubRulesetAttributes => ({
      owner: props.owner,
      repository: props.repository,
      ...toObservedRuleset(reply),
    }))
  );
};

/**
 * Update the known (or same-named) ruleset only when it no longer matches, and create one only
 * when neither exists.
 */
export const convergeRuleset = Effect.fn("convergeRuleset")(
  function* convergeRuleset(
    props: GitHubRulesetProps,
    knownRulesetId?: number
  ) {
    const current =
      knownRulesetId === undefined
        ? yield* findRulesetByName(props)
        : yield* getRuleset(props.owner, props.repository, knownRulesetId);
    if (Option.isSome(current) && rulesetMatches(props, current.value)) {
      return current.value;
    }
    return yield* writeRuleset(
      props,
      current.pipe(Option.map((ruleset) => ruleset.rulesetId))
    );
  }
);

/**
 * Moving to another repository replaces the ruleset. Otherwise the stored observation decides;
 * when it is missing, reconcile compares against the live ruleset itself.
 */
export const rulesetDiff = (
  news: GitHubRulesetProps,
  olds: GitHubRulesetProps,
  output: GitHubRulesetAttributes | undefined
) => {
  if (news.owner !== olds.owner || news.repository !== olds.repository) {
    return { action: "replace" } as const;
  }
  const upToDate = output !== undefined && rulesetMatches(news, output);
  return upToDate
    ? ({ action: "noop" } as const)
    : ({ action: "update" } as const);
};

export const gitHubRulesetProvider = () =>
  Provider.succeed(GitHubRuleset, {
    stables: ["rulesetId", "owner", "repository"],
    diff: ({ news, olds, output }) =>
      Effect.sync(() =>
        isResolved(news)
          ? rulesetDiff(news, olds, output)
          : ({ action: "update" } as const)
      ),
    // Without state, a same-named ruleset exists but was made by hand: report it as unowned so
    // taking it over needs an explicit `adopt(true)` at the declaration.
    read: ({ olds, output }) =>
      output === undefined
        ? findRulesetByName(olds).pipe(
            Effect.map(Option.map(Unowned)),
            Effect.map(Option.getOrUndefined)
          )
        : getRuleset(output.owner, output.repository, output.rulesetId).pipe(
            Effect.map(Option.getOrUndefined)
          ),
    reconcile: ({ news, output }) => convergeRuleset(news, output?.rulesetId),
    delete: ({ output }) =>
      gitHubRequest(
        `delete ruleset ${output.rulesetId}`,
        "DELETE",
        `${repoPath(output.owner, output.repository)}/rulesets/${output.rulesetId}`
      ).pipe(
        Effect.flatMap((request) => sendJson(request, Schema.Unknown)),
        Effect.asVoid
      ),
  });

// ---------------------------------------------------------------------------------------------
// Adoption reads for Alchemy's own GitHub providers
// ---------------------------------------------------------------------------------------------

const RepositoryReply = Schema.Struct({
  id: Schema.Number,
  node_id: Schema.String,
  full_name: Schema.String,
  html_url: Schema.String,
  git_url: Schema.String,
  ssh_url: Schema.String,
  clone_url: Schema.String,
  default_branch: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
});

const EnvironmentReply = Schema.Struct({
  id: Schema.Number,
  node_id: Schema.String,
  name: Schema.String,
  html_url: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
});

const VariableReply = Schema.Struct({
  name: Schema.String,
  updated_at: Schema.String,
});

type ReadInput<R extends ResourceLike> = Parameters<
  NonNullable<Provider.ProviderService<R>["read"]>
>[0];

/** Replace one provider's `read`, keeping every other lifecycle method from Alchemy. */
const withRead = <R extends ResourceLike, BaseReq, ReadReq>(
  resource: ResourceClassLike<R>,
  base: Layer.Layer<Provider.Provider<R>, never, BaseReq>,
  read: (
    service: Provider.ProviderService<R>
  ) => (
    input: ReadInput<R>
  ) => Effect.Effect<R["Attributes"] | undefined, unknown, ReadReq>
) =>
  Provider.effect(
    resource,
    Effect.map(Provider.Provider<R>(resource.Type), (service) => ({
      ...service,
      read: read(service),
    }))
  ).pipe(Layer.provide(base));

const readRepository = (props: GitHub.RepositoryProps) =>
  gitHubRequest(
    `read repository ${props.owner}/${props.name}`,
    "GET",
    repoPath(props.owner, props.name)
  ).pipe(
    Effect.flatMap((request) => sendJson(request, RepositoryReply)),
    Effect.map(
      Option.map((repo) => ({
        repoId: repo.id,
        nodeId: repo.node_id,
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        gitUrl: repo.git_url,
        sshUrl: repo.ssh_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
      }))
    ),
    Effect.map(Option.getOrUndefined)
  );

const readEnvironment = (props: GitHub.EnvironmentProps) =>
  gitHubRequest(
    `read environment ${props.name}`,
    "GET",
    `${repoPath(props.owner, props.repository)}/environments/${encodeURIComponent(props.name)}`
  ).pipe(
    Effect.flatMap((request) => sendJson(request, EnvironmentReply)),
    Effect.map(
      Option.map((environment) => ({
        environmentId: environment.id,
        nodeId: environment.node_id,
        name: environment.name,
        htmlUrl: environment.html_url,
        createdAt: environment.created_at,
        updatedAt: environment.updated_at,
      }))
    ),
    Effect.map(Option.getOrUndefined)
  );

const readVariable = (props: GitHub.VariableProps) => {
  const environment = GitHub.resolveEnvironmentName(props.environment);
  const scope =
    environment === undefined
      ? ""
      : `/environments/${encodeURIComponent(environment)}`;
  return gitHubRequest(
    `read variable ${props.name}`,
    "GET",
    `${repoPath(props.owner, props.repository)}${scope}/variables/${encodeURIComponent(props.name)}`
  ).pipe(Effect.flatMap((request) => sendJson(request, VariableReply)));
};

/**
 * Alchemy's GitHub providers plus the ruleset resource. Repository, Environment, and Variable
 * gain a `read` that looks the object up by name.
 */
export const gitHubProviders = () =>
  Layer.mergeAll(
    // Once state exists, Alchemy's own read follows the repository id across renames.
    withRead(
      GitHub.Repository,
      GitHub.RepositoryProvider(),
      (base) => (input) =>
        input.output === undefined || base.read === undefined
          ? readRepository(input.olds)
          : base.read(input)
    ),
    withRead(
      GitHub.Environment,
      GitHub.EnvironmentProvider(),
      () => (input) => readEnvironment(input.olds)
    ),
    // Alchemy stamps the variable's `updatedAt` with its own clock, so keep the stored value and
    // report only whether the variable still exists.
    withRead(
      GitHub.Variable,
      GitHub.VariableProvider(),
      () => (input) =>
        readVariable(input.olds).pipe(
          Effect.map(
            Option.map((variable) => ({
              updatedAt: input.output?.updatedAt ?? variable.updated_at,
            }))
          ),
          Effect.map(Option.getOrUndefined)
        )
    ),
    gitHubRulesetProvider()
  ).pipe(
    Layer.provideMerge(GitHub.providers()),
    Layer.provideMerge(FetchHttpClient.layer)
  );
