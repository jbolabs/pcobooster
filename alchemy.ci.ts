/**
 * The CI/deploy control plane: repository merge settings, the `main` ruleset, the deployment
 * environments and their variables, Cloudflare deploy tokens, staging's Access service token, and
 * encrypted GitHub environment secrets that hand credentials to GitHub Actions.
 *
 * Run it locally with `bun run infra:plan` and `bun run infra:deploy`; see docs/ci-cd.md for the
 * credentials each needs. The stack keeps its state in the shared Cloudflare state store under
 * the `ci` stage.
 */
import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Config, Effect, Layer, Redacted } from "effect";

import { existingZoneId } from "./scripts/cloudflare/zones";
import { accountApiTokenProvider } from "./scripts/infra/cloudflare";
import { gitHubProviders, GitHubRuleset } from "./scripts/infra/github";
import { mainRuleset } from "./scripts/infra/main-ruleset";

const owner = "jbolabs";
const repository = "pcobooster";
const accountId = "984b82870acd18daf8bda97bad966b38";

/**
 * Deploy tokens are minted per generation. Bumping `generation` mints fresh tokens, writes them
 * to GitHub environment secrets, and then revokes the previous generation in the same deploy. Rotate before
 * `expiresOn`.
 */
const deployTokens = {
  generation: 1,
  expiresOn: "2027-09-23T23:59:59Z",
} as const;

const accountScope = { [`com.cloudflare.api.account.${accountId}`]: "*" };
/** Account-level Flagship Write (includes read); Alchemy's typed catalog does not list it yet. */
const FLAGSHIP_WRITE = { id: "521a41dc78f94eaba5e643528846cb7b" };
/**
 * Account-level Access: Apps and Policies Write. Cloudflare has a zone-level group with the same
 * name, and Alchemy resolves a name to the first match, the zone one, which cannot create
 * account Access applications. Always reference this group by id.
 */
const ACCESS_APPS_WRITE = { id: "1e13c5124ca64b72b1969a67e8829049" };

const deployPermissions: Cloudflare.ApiToken.PermissionGroupRef[] = [
  "Workers Scripts Write",
  "D1 Write",
  // Each deployed stage declares a KV namespace for the shared Planning Center read cache
  // (`apps/server/src/planning-center-cache.ts`).
  "Workers KV Storage Write",
  // Each deployed stage declares an R2 bucket for the iOS app's over-the-air updates
  // (`apps/server/src/mobile-update-bucket.ts`). Deploys create and bind it; they never write updates.
  "Workers R2 Storage Write",
  // The shared Alchemy state store keeps its bearer token in the account Secrets Store.
  "Secrets Store Write",
  // Each deployed stage declares a Flagship app and its flags (`apps/server/src/feature-flags.ts`).
  FLAGSHIP_WRITE,
  // Staging's and previews' product Workers each declare a Cloudflare Access application
  // (`alchemy.run.ts`); production deletes the former admin Worker's on its next deploy.
  ACCESS_APPS_WRITE,
];

/** Separate deployment tokens per trust level; credentials stay scoped to GitHub environments. */
interface DeployTarget {
  readonly key: "Preview" | "Production";
  readonly environments: readonly string[];
  readonly policies: Cloudflare.ApiToken.Policy[];
}
const preview: DeployTarget = {
  key: "Preview",
  environments: [
    "cloudflare-preview",
    "cloudflare-preview-cleanup",
    "cloudflare-staging",
  ],
  policies: [
    {
      effect: "allow",
      permissionGroups: deployPermissions,
      resources: accountScope,
    },
  ],
};
/**
 * The one GitHub environment for production secrets, shared by every jbolabs repository: `main`
 * only, and the only subject Infisical's `ci-prod` identity trusts
 * (`repo:jbolabs@305914027/*:environment:production`).
 */
export const productionEnvironment = "production";

const production: DeployTarget = {
  key: "Production",
  environments: [productionEnvironment],
  policies: [
    {
      effect: "allow",
      permissionGroups: deployPermissions,
      resources: accountScope,
    },
  ],
};

/**
 * Zones `alchemy.run.ts` manages in the `prod` stage: their DNS records, bot settings, and
 * custom WAF rules. The token cannot create zones (that needs Zone Write on every zone in the
 * account), so each is created by hand and must exist before this stack resolves its id by name.
 */
const productionZones = ["pcobooster.com"] as const;

const productionZonePolicy = (
  zoneIds: readonly string[]
): Cloudflare.ApiToken.Policy => ({
  effect: "allow",
  permissionGroups: [
    "Zone Read",
    "DNS Write",
    "Zone WAF Write",
    "Bot Management Write",
  ],
  // Zone grants on an account-owned token nest under the account resource.
  resources: {
    [`com.cloudflare.api.account.${accountId}`]: Object.fromEntries(
      zoneIds.map((zoneId) => [
        `com.cloudflare.api.account.zone.${zoneId}`,
        "*",
      ])
    ),
  },
});

/**
 * GitHub deployment environments. Variables name the environment as a string so their props stay
 * resolvable at plan time.
 */
interface DeployEnvironment {
  readonly id: string;
  readonly name: string;
  readonly target: DeployTarget;
  readonly reviewers: GitHub.EnvironmentProps["reviewers"];
  readonly branches: GitHub.EnvironmentProps["deploymentBranchPolicy"];
  readonly variables: Readonly<Record<string, string>>;
}

export const environments: readonly DeployEnvironment[] = [
  {
    id: "PreviewEnvironment",
    name: "cloudflare-preview",
    target: preview,
    // The `preview` label is the approval; fork pull requests never reach this environment.
    reviewers: undefined,
    branches: undefined,
    variables: {},
  },
  {
    id: "PreviewCleanupEnvironment",
    name: "cloudflare-preview-cleanup",
    target: preview,
    // Teardown runs only trusted `main` code, so it needs no approval.
    reviewers: undefined,
    branches: { customBranchPolicies: ["main"] },
    variables: {},
  },
  {
    id: "StagingEnvironment",
    name: "cloudflare-staging",
    target: preview,
    // Every push to `main` deploys staging before production.
    reviewers: undefined,
    branches: { customBranchPolicies: ["main"] },
    variables: {},
  },
  {
    // Formerly `cloudflare-production` (id `ProductionEnvironment`). A new id, so its variables and
    // token secret get new ids too: Alchemy creates them in `production` and leaves the retained
    // `cloudflare-production` copies untouched until that environment is deleted by hand.
    id: "ProductionGitHubEnvironment",
    name: productionEnvironment,
    target: production,
    // Merging to `main` is the approval: every push to `main` deploys.
    reviewers: undefined,
    branches: { customBranchPolicies: ["main"] },
    variables: {
      CLOUDFLARE_CUSTOM_DOMAINS: "1",
      // Infisical GitHub OIDC login as `ci-prod` for jobs that read `pcobooster-prod`
      // (project `infisical.prod`).
      INFISICAL_IDENTITY_ID: "23fa16cc-a7a1-4e35-8011-2f24b0e037ba",
      INFISICAL_OIDC_AUDIENCE: "https://github.com/jbolabs",
    },
  },
  {
    id: "TestFlightEnvironment",
    name: "testflight",
    target: production,
    // Merging iOS changes to `main` is the approval, as for production.
    reviewers: undefined,
    branches: { customBranchPolicies: ["main"] },
    variables: {},
  },
];

const ciState = Layer.unwrap(
  Alchemy.Stage.pipe(
    Effect.flatMap((stage) =>
      stage === "ci"
        ? Effect.succeed(Cloudflare.state())
        : Effect.die(
            new Error(`The CI stack only deploys --stage ci: ${stage}`)
          )
    )
  )
);

const deployTarget = Effect.fn("deployTarget")(function* deployTarget(
  target: DeployTarget
) {
  const tokenName = `pcobooster-${target.key.toLowerCase()}-deploy-g${deployTokens.generation}`;
  const token = yield* Cloudflare.ApiToken.AccountApiToken(
    `${target.key}DeployToken${deployTokens.generation}`,
    {
      name: tokenName,
      accountId,
      policies: target.policies,
      expiresOn: deployTokens.expiresOn,
    }
  );
  for (const environment of target.environments) {
    yield* GitHub.Secret(`${target.key}${environment}CloudflareApiToken`, {
      owner,
      repository,
      environment,
      name: "CLOUDFLARE_API_TOKEN",
      value: token.value,
    }).pipe(RemovalPolicy.retain());
  }
  return token.tokenId;
});

const toRedacted = (value: string) => Redacted.make(value);

/** Cloudflare reveals a client secret only on create and rotate; Alchemy keeps it in state. */
const requireClientSecret = (
  secret: Redacted.Redacted | undefined
): Redacted.Redacted => {
  if (secret === undefined) {
    throw new Error(
      "The staging Access client secret is missing from state; bump clientSecretVersion to rotate it."
    );
  }
  return secret;
};

/**
 * Lets the staging deploy job verify the deploy through Cloudflare Access without a login.
 * `alchemy.run.ts` admits it by id; the client credentials use the names Alchemy's Access client
 * reads. They live only in the preview and staging GitHub environments.
 * Rotate by bumping `clientSecretVersion`.
 */
const stagingAccessServiceToken = Effect.gen(function* stagingAccessToken() {
  const token = yield* Cloudflare.Access.ServiceToken("StagingDeployCheck", {
    name: "pcobooster-staging-deploy-check",
    duration: "8760h",
    clientSecretVersion: 1,
  });
  for (const environment of ["cloudflare-preview", "cloudflare-staging"]) {
    yield* GitHub.Variable(`${environment}StagingAccessServiceTokenId`, {
      owner,
      repository,
      environment,
      name: "STAGING_ACCESS_SERVICE_TOKEN_ID",
      value: token.serviceTokenId,
    }).pipe(RemovalPolicy.retain());
    yield* GitHub.Secret(`${environment}StagingAccessClientId`, {
      owner,
      repository,
      environment,
      name: "CLOUDFLARE_ACCESS_CLIENT_ID",
      value: Output.map(toRedacted)(token.clientId),
    }).pipe(RemovalPolicy.retain());
    yield* GitHub.Secret(`${environment}StagingAccessClientSecret`, {
      owner,
      repository,
      environment,
      name: "CLOUDFLARE_ACCESS_CLIENT_SECRET",
      value: Output.map(requireClientSecret)(token.clientSecret),
    }).pipe(RemovalPolicy.retain());
  }
  return token.serviceTokenId;
});

export default Alchemy.Stack(
  "pcobooster-ci",
  {
    providers: Layer.mergeAll(
      gitHubProviders(),
      accountApiTokenProvider()
    ).pipe(Layer.provideMerge(Cloudflare.providers())),
    state: ciState,
  },
  Effect.gen(function* ciControlPlane() {
    const target = { owner, repository };

    yield* GitHub.Repository("Repository", {
      owner,
      name: repository,
      defaultBranch: "main",
      // Squash is the only way into `main` (the ruleset enforces it); merge commits are off.
      // `allowRebaseMerge` stays unmanaged: stacked PRs into non-`main` branches may rebase.
      allowSquashMerge: true,
      allowMergeCommit: false,
      allowAutoMerge: true,
      deleteBranchOnMerge: true,
    });

    // The live ruleset predates this stack: adopt it by name, never create a second one.
    const ruleset = yield* GitHubRuleset("MainRuleset", {
      ...target,
      ...mainRuleset,
    }).pipe(adopt(true));

    for (const environment of environments) {
      yield* GitHub.Environment(environment.id, {
        ...target,
        name: environment.name,
        reviewers: environment.reviewers,
        deploymentBranchPolicy: environment.branches,
      }).pipe(RemovalPolicy.retain());
      const variables = {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        ...environment.variables,
      };
      if (
        environment.name !== "testflight" &&
        environment.name !== "cloudflare-preview-cleanup"
      ) {
        Object.assign(variables, {
          PCOBOOSTER_ADMIN_EMAILS: yield* Config.String(
            environment.target.key === "Production"
              ? "CI_PRODUCTION_ADMIN_EMAILS"
              : "CI_PREVIEW_ADMIN_EMAILS"
          ),
        });
      }
      for (const [name, value] of Object.entries(variables)) {
        yield* GitHub.Variable(`${environment.id}${name}`, {
          ...target,
          environment: environment.name,
          name,
          value,
        }).pipe(RemovalPolicy.retain());
      }
    }

    // Legacy TestFlight switch remains inert; the release executor stays blocked.
    yield* GitHub.Variable("TestFlightReleases", {
      ...target,
      name: "TESTFLIGHT_RELEASES",
      value: "enabled",
    });

    const annotationKey = yield* Config.Redacted(
      "POSTHOG_ANNOTATION_API_KEY"
    ).pipe(Config.option);
    if (annotationKey._tag === "Some") {
      yield* GitHub.Secret("ProductionEnvironmentPostHogAnnotationKey", {
        ...target,
        environment: productionEnvironment,
        name: "POSTHOG_ANNOTATION_API_KEY",
        value: annotationKey.value,
      }).pipe(RemovalPolicy.retain());
    }
    const previewTokenId = yield* deployTarget(preview);
    const stagingServiceTokenId = yield* stagingAccessServiceToken;
    const productionZoneIds: string[] = [];
    for (const name of productionZones) {
      productionZoneIds.push(yield* existingZoneId(accountId, name));
    }
    const productionTokenId = yield* deployTarget({
      ...production,
      policies: [
        ...production.policies,
        productionZonePolicy(productionZoneIds),
      ],
    });

    return {
      rulesetId: ruleset.rulesetId,
      previewTokenId,
      stagingServiceTokenId,
      productionTokenId,
    };
  })
);
