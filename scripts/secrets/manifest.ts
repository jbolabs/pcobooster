import { Schema } from "effect";

export const secretScopeSchema = Schema.Literals([
  "local",
  "sandbox",
  "cloud",
  "preview",
  "production",
  "apple",
  "mobile-updates",
  "posthog",
  "analytics-erasure",
  "recovery",
  "builds-control",
]);
export type SecretScope = typeof secretScopeSchema.Type;

/** The scope named on the command line; anything else is a usage error. */
export const parseSecretScope = Schema.decodeUnknownSync(secretScopeSchema);

/** The exit code from a child process's `exit` or `close` event arguments. */
export const processExit = Schema.decodeUnknownSync(
  Schema.Tuple([Schema.NullOr(Schema.Number), Schema.NullOr(Schema.String)])
);

export const runtimeSecretKeys = [
  "BETTER_AUTH_SECRET",
  "OAUTH_PROXY_SECRET",
  "PLANNING_CENTER_OAUTH_CLIENT_ID",
  "PLANNING_CENTER_OAUTH_CLIENT_SECRET",
  "DEMO_ACCESS_KEY",
  "DEMO_PLANNING_CENTER_CLIENT",
  "DEMO_PLANNING_CENTER_PAT",
  // Production only: the API Worker's analytics erasure cron. A PostHog personal API key limited
  // to `person:write` on project 614621.
  "POSTHOG_ERASURE_API_KEY",
] as const;
export type RuntimeSecretKey = (typeof runtimeSecretKeys)[number];

const localKeys = [
  "BETTER_AUTH_SECRET",
  "PLANNING_CENTER_OAUTH_CLIENT_ID",
  "PLANNING_CENTER_OAUTH_CLIENT_SECRET",
  "PLANNING_CENTER_CLIENT",
  "PLANNING_CENTER_PAT",
  "PRESENTATION_SEED",
  "PCOBOOSTER_ADMIN_EMAILS",
] as const;
const deploymentKeys = [
  "CLOUDFLARE_API_TOKEN",
  "PCOBOOSTER_ADMIN_EMAILS",
  "STAGING_ACCESS_SERVICE_TOKEN_ID",
  "CLOUDFLARE_ACCESS_CLIENT_ID",
  "CLOUDFLARE_ACCESS_CLIENT_SECRET",
  "POSTHOG_ANNOTATION_API_KEY",
] as const;
const inheritedCredentialKeys = [
  "ASC_KEY_PATH",
  "CLOUDFLARE_TOKEN_ADMIN_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_API_BASE_URL",
  "CLOUDFLARE_ACCESS_TOKEN",
] as const;

/**
 * Only these keys may be injected into commands in each trust boundary. Alchemy stacks read
 * Infisical directly (`stacks/secrets.ts`); `local`, `cloud`, `preview`, and `production`
 * remain for the importer, `secrets:dev`, and the legacy Keychain deploy commands.
 */
export const scopeKeys: Record<SecretScope, readonly string[]> = {
  "builds-control": ["BUILDS_GITHUB_APP_PRIVATE_KEY"],
  local: localKeys,
  sandbox: ["PLANNING_CENTER_CLIENT", "PLANNING_CENTER_PAT"],
  // What `secrets:dev` passes from Infisical `pcobooster-dev` to a non-Alchemy command. The PAT
  // is a deliberate grant: it acts as its owner on real Planning Center data and shares their
  // rate limit.
  cloud: [
    "BETTER_AUTH_SECRET",
    "PLANNING_CENTER_OAUTH_CLIENT_ID",
    "PLANNING_CENTER_OAUTH_CLIENT_SECRET",
    "PLANNING_CENTER_CLIENT",
    "PLANNING_CENTER_PAT",
    "PCOBOOSTER_ADMIN_EMAILS",
  ],
  preview: [...runtimeSecretKeys.slice(1, 4), ...deploymentKeys],
  production: [...runtimeSecretKeys, ...deploymentKeys],
  apple: [
    "ASC_KEY_ID",
    "ASC_ISSUER_ID",
    "ASC_KEY_P8_BASE64",
    "POSTHOG_CLI_API_KEY",
    "POSTHOG_CLI_PROJECT_ID",
  ],
  // Only the update signing key: publishing reaches Cloudflare with the operator's Alchemy login.
  "mobile-updates": ["UPDATES_SIGNING_KEY_PEM_BASE64"],
  posthog: ["POSTHOG_PERSONAL_API_KEY"],
  // Inspecting or hand-running the analytics erasure queue (`analytics:erase`) that the production
  // API Worker's cron runs: a PostHog key limited to `person:write` and a Cloudflare token limited
  // to D1 edit, nothing else.
  "analytics-erasure": ["POSTHOG_ERASURE_API_KEY", "CLOUDFLARE_D1_API_TOKEN"],
  recovery: ["DATABASE_URL", "BETTER_AUTH_SECRET"],
};

export const requiredScopeKeys: Record<SecretScope, readonly string[]> = {
  "builds-control": scopeKeys["builds-control"],
  local: localKeys.slice(0, 3),
  sandbox: scopeKeys.sandbox,
  cloud: scopeKeys.cloud.slice(0, 3),
  preview: [],
  production: [],
  apple: ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_P8_BASE64"],
  "mobile-updates": ["UPDATES_SIGNING_KEY_PEM_BASE64"],
  posthog: ["POSTHOG_PERSONAL_API_KEY"],
  "analytics-erasure": ["CLOUDFLARE_D1_API_TOKEN"],
  recovery: ["DATABASE_URL"],
};

const componentPattern = /^[a-z][a-z0-9-]*$/u;
const keyPattern = /^[A-Z][A-Z0-9_]*$/u;

export const storeSecretName = (
  app: string,
  environment: string,
  purpose: string,
  key: string
): string => {
  if (
    ![app, environment, purpose].every((part) => componentPattern.test(part)) ||
    !keyPattern.test(key) ||
    key.includes("__")
  ) {
    throw new Error("Invalid secret namespace component");
  }
  return `${app}__${environment}__${purpose}__${key}`;
};

export const runtimeSecretPurpose = (key: RuntimeSecretKey): string => {
  if (key.startsWith("DEMO_")) {
    return "demo";
  }
  if (key.startsWith("PLANNING_CENTER_")) {
    return "planning-center";
  }
  if (key.startsWith("POSTHOG_")) {
    return "analytics";
  }
  return "auth";
};

export const storedRuntimeKeys = (
  production: boolean
): readonly RuntimeSecretKey[] =>
  production
    ? runtimeSecretKeys
    : [
        "OAUTH_PROXY_SECRET",
        "PLANNING_CENTER_OAUTH_CLIENT_ID",
        "PLANNING_CENTER_OAUTH_CLIENT_SECRET",
      ];

export const keychainService = (scope: SecretScope): string =>
  `com.pcobooster.secrets.${scope}`;

export const selectScopeValues = (
  scope: SecretScope,
  values: Readonly<Record<string, string>>
): Record<string, string> =>
  Object.fromEntries(
    scopeKeys[scope].flatMap((key) => {
      const value = values[key];
      return value === undefined || value === "" ? [] : [[key, value]];
    })
  );

/** Development switches each launcher sets itself; an inherited value never counts. */
const processOwnedKeys = new Set([
  "DEV_AUTH_BYPASS",
  "DEV_PLANNING_CENTER_ACCESS",
  "DEV_PLANNING_CENTER_ORGANIZATION",
  "PRESENTATION_MODE",
]);

/** The parent environment without any known credential or process-owned switch. */
const withoutCredentials = (parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const environment = { ...parent };
  for (const key of new Set([
    ...Object.values(scopeKeys).flat(),
    ...inheritedCredentialKeys,
    ...processOwnedKeys,
  ])) {
    Reflect.deleteProperty(environment, key);
  }
  return environment;
};

/**
 * The environment for `alchemy dev --stage local`. Stale shell credentials are removed because the
 * shell outranks Infisical in Alchemy's precedence; `overrides` (the sandbox PAT) deliberately
 * outrank it. Infisical auth variables stay: Alchemy itself reads `INFISICAL_TOKEN`, never a Worker.
 * Alchemy resolves Cloudflare credentials even for local providers, so the stage gets placeholders,
 * not grants, and runs the same with or without a Cloudflare login.
 */
export const developmentEnvironment = (
  parent: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>>
): NodeJS.ProcessEnv => ({
  ...withoutCredentials(parent),
  CLOUDFLARE_ACCOUNT_ID: "00000000000000000000000000000000",
  CLOUDFLARE_API_TOKEN: "local-development-never-reaches-cloudflare",
  ...overrides,
});

/** Strip every known credential before adding the selected scope, including stale parent values. */
export const commandEnvironment = (
  scope: SecretScope,
  parent: NodeJS.ProcessEnv,
  values: Readonly<Record<string, string>>
): NodeJS.ProcessEnv => {
  const environment = withoutCredentials(parent);
  for (const key of Object.keys(environment)) {
    if (key.startsWith("INFISICAL_")) {
      Reflect.deleteProperty(environment, key);
    }
  }
  return { ...environment, ...selectScopeValues(scope, values) };
};
