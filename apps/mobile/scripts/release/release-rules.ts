/**
 * The rules a TestFlight release follows before anything reaches Apple: which credentials sign it,
 * and which build number it may use. `release-cli.ts` applies them; `release-ios.sh` calls it.
 */

/** The native app before the Expo migration shipped build 292 for version 0.1.0. */
export const BUILD_NUMBER_FLOOR = 292;

const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const FALSE_FORMS = new Set(["", "0", "false", "no", "off"]);

/** Environment variables that mark a run as automation, as CI providers set them. */
const AUTOMATION_VARIABLES = [
  "CI",
  "GITHUB_ACTIONS",
  "BUILDKITE",
  "CIRCLECI",
  "GITLAB_CI",
  "JENKINS_URL",
  "TF_BUILD",
] as const;

/**
 * The variable that marks this run as automation, or null for an interactive local run. Any
 * value but an empty or false-like one counts, so `CI=1`, `CI=yes`, and `CI=TRUE` all do.
 */
export const automationMarker = (
  env: Readonly<Record<string, string | undefined>>
): string | null =>
  AUTOMATION_VARIABLES.find((name) => {
    const value = env[name];
    return value !== undefined && !FALSE_FORMS.has(value.trim().toLowerCase());
  }) ?? null;

export type SigningMode = "api-key" | "xcode-account";

export interface SigningInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether a complete App Store Connect API key was supplied. */
  readonly hasKey: boolean;
}

interface LocalExportSigning {
  readonly certificateSha1: string;
  readonly profileUuid: string;
}

const CERTIFICATE_SHA1 = /^[\da-f]{40}$/iu;
const PROFILE_UUID =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

/** Explicit local identities only; never select a certificate or profile by an ambiguous name. */
const localExportSigning = (
  env: SigningInput["env"]
): LocalExportSigning | null => {
  const certificateSha1 = env.PCOB_RELEASE_CERTIFICATE_SHA1 ?? "";
  const profileUuid = env.PCOB_RELEASE_PROFILE_UUID ?? "";
  if (certificateSha1 === "" && profileUuid === "") {
    return null;
  }
  if (automationMarker(env) !== null) {
    throw new Error(
      "Explicit local distribution signing is unavailable in automation."
    );
  }
  if (
    !CERTIFICATE_SHA1.test(certificateSha1) ||
    !PROFILE_UUID.test(profileUuid)
  ) {
    throw new Error(
      "Supply PCOB_RELEASE_CERTIFICATE_SHA1 (40 hex characters) and PCOB_RELEASE_PROFILE_UUID (UUID) together."
    );
  }
  return {
    certificateSha1: certificateSha1.toUpperCase(),
    profileUuid: profileUuid.toUpperCase(),
  };
};

/**
 * How the export signs. A supplied key signs unless `PCOB_RELEASE_SIGNING=xcode-account` asks
 * for the Apple account signed into Xcode (the key then only checks build numbers). Automation
 * never falls back to an account on the machine.
 */
export const signingMode = ({ env, hasKey }: SigningInput): SigningMode => {
  const requested = env.PCOB_RELEASE_SIGNING ?? "";
  if (!["", "api-key", "xcode-account"].includes(requested)) {
    throw new Error("PCOB_RELEASE_SIGNING must be api-key or xcode-account.");
  }
  const marker = automationMarker(env);
  const mode: SigningMode =
    requested === "xcode-account" || (requested === "" && !hasKey)
      ? "xcode-account"
      : "api-key";
  if (mode === "xcode-account" && marker !== null) {
    throw new Error(
      `${marker} marks this run as automation, which must sign with an App Store Connect API key, not an Apple account in Xcode.`
    );
  }
  if (mode === "api-key" && !hasKey) {
    throw new Error(
      "PCOB_RELEASE_SIGNING=api-key needs ASC_KEY_ID, ASC_ISSUER_ID, and a private key."
    );
  }
  if (localExportSigning(env) !== null && mode !== "api-key") {
    throw new Error(
      "Explicit local distribution signing requires PCOB_RELEASE_SIGNING=api-key and an App Store Connect API key."
    );
  }
  return mode;
};

/** Fixed app/team export settings; validated hex/UUID values cannot inject plist XML. */
export const exportOptionsPlist = (input: SigningInput): string => {
  signingMode(input);
  const local = localExportSigning(input.env);
  const identity =
    local === null
      ? "  <key>signingStyle</key><string>automatic</string>"
      : `  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>${local.certificateSha1}</string>
  <key>provisioningProfiles</key><dict>
    <key>com.pcobooster.ios</key><string>${local.profileUuid}</string>
  </dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>6C46GY4Z38</string>
${identity}
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>testFlightInternalTestingOnly</key><false/>
  <key>uploadSymbols</key><true/>
</dict></plist>
`;
};

/** A build number as typed: a positive integer without leading zeros, or an error. */
export const parseBuildNumber = (value: string): number => {
  if (!POSITIVE_INTEGER.test(value)) {
    throw new Error(
      "BUILD_NUMBER must be a positive integer without leading zeros."
    );
  }
  return Number(value);
};

/** Build numbers already taken: uploaded or processing in App Store Connect, or claimed here. */
export interface TakenBuildNumbers {
  /** From App Store Connect builds and build uploads; null when no key could ask. */
  readonly appStoreConnect: readonly number[] | null;
  /** Claimed by earlier release runs on this machine, uploaded or not. */
  readonly claimed: readonly number[];
}

const highest = (numbers: readonly number[]): number => {
  let max = BUILD_NUMBER_FLOOR;
  for (const value of numbers) {
    max = Math.max(max, value);
  }
  return max;
};

/**
 * The build number a release uses. With App Store Connect's numbers known, the next one after
 * every taken number, or the requested one when it is higher than all of them. Without them, only
 * an explicit number, still above the floor and every local claim. Apple rejects a build number
 * at or below one it already has, so a number never goes backward, even after a failed upload.
 */
export const chooseBuildNumber = (
  taken: TakenBuildNumbers,
  requested: number | null
): number => {
  const known = [...(taken.appStoreConnect ?? []), ...taken.claimed];
  const ceiling = highest(known);
  if (requested === null) {
    if (taken.appStoreConnect === null) {
      throw new Error(
        "Without an App Store Connect API key to check build numbers, set BUILD_NUMBER to a number above every uploaded build."
      );
    }
    return ceiling + 1;
  }
  if (requested <= ceiling) {
    const source = taken.claimed.includes(ceiling)
      ? "a release on this machine claimed"
      : "App Store Connect already has";
    throw new Error(
      `BUILD_NUMBER ${requested} is not above ${ceiling}, which ${ceiling === BUILD_NUMBER_FLOOR ? "the previous native app shipped" : source}.`
    );
  }
  return requested;
};

/**
 * Whether a chosen build number is still free just before upload: another release may have
 * uploaded it, or a higher one, while this one archived.
 */
export const stillUnused = (
  build: number,
  appStoreConnect: readonly number[]
): void => {
  const ceiling = highest(appStoreConnect);
  if (build <= ceiling) {
    throw new Error(
      `App Store Connect now has build ${ceiling}, so build ${build} cannot upload. Nothing was uploaded; start a new release.`
    );
  }
};

/**
 * PostHog project 614621's public ingestion key, the same one pcobooster.com serves in its web
 * bundle. It is a client key, not a secret, so it is committed here: every release archive bakes
 * it in from source, and no release step has to read the application's secrets to get it.
 */
export const POSTHOG_PROJECT_KEY =
  "phc_AknTLSXtT8F8KEuukTcnuS7DKSiekTGmDMfVy3UBn8B4";

const ANALYTICS_KEY_VARIABLES = [
  "EXPO_PUBLIC_POSTHOG_KEY",
  "POSTHOG_PROJECT_KEY",
] as const;

/**
 * The analytics key a release archive embeds. A key in the environment must be this same key, so
 * a release can neither ship with analytics silently off nor report to another project.
 */
export const releaseAnalyticsKey = (
  env: Readonly<Record<string, string | undefined>>
): string => {
  for (const name of ANALYTICS_KEY_VARIABLES) {
    const value = env[name] ?? "";
    if (value !== "" && value !== POSTHOG_PROJECT_KEY) {
      throw new Error(
        `${name} is not pcobooster.com's PostHog project key. Unset it; releases embed the committed key.`
      );
    }
  }
  return POSTHOG_PROJECT_KEY;
};

/**
 * Embedded frameworks that ship without a dSYM: React Native's prebuilt binaries, as build 373's
 * real export showed. Apple cannot symbolicate native frames inside them; the app's own binary
 * and every framework built from source still need symbols.
 */
export const PREBUILT_FRAMEWORKS_WITHOUT_DSYMS = [
  "React.framework",
  "ReactNativeDependencies.framework",
  "hermesvm.framework",
] as const;

export type ProcessingOutcome = "processed" | "failed" | "pending";

const FAILED_PROCESSING = new Set(["FAILED", "INVALID"]);

/**
 * Where App Store Connect's processing of an uploaded build stands. Only a VALID, unexpired build
 * with this exact build number and version counts as processed; a build not listed yet is pending.
 */
export const processingOutcome = (
  state: {
    readonly processingState: string | null;
    readonly version: string | null;
    readonly shortVersion: string | null;
    readonly expired: boolean | null;
  } | null,
  build: number,
  version: string
): ProcessingOutcome => {
  if (
    state?.processingState === "VALID" &&
    state.version === String(build) &&
    state.shortVersion === version &&
    state.expired !== true
  ) {
    return "processed";
  }
  return FAILED_PROCESSING.has(state?.processingState ?? "")
    ? "failed"
    : "pending";
};
