import type { FeatureFlagName } from "@pcobooster/contracts/features";

/**
 * Every feature flag the product evaluates, one entry per name in the contracts' flag list.
 * Infrastructure (`apps/server/src/feature-flags.ts`) declares one Cloudflare Flagship flag per
 * entry, and the API and browser evaluate flags only by these names, so code and infrastructure
 * cannot disagree about which flags exist. Alchemy owns each flag's configuration: a deploy
 * overwrites edits made in the Cloudflare dashboard.
 */

/**
 * Where a stage runs: `local` (`alchemy dev`), `preview` (`pr-<number>` and `staging`), or
 * `production`.
 */
export type DeploymentTier = "local" | "preview" | "production";

/** A boolean flag. Flagship serves `on` (true) or `off` (false). */
export interface BooleanFeatureFlag {
  /** The Flagship flag key: letters, numbers, hyphens, and underscores, at most 64 characters. */
  readonly key: string;
  /** Shown in the Cloudflare dashboard; at most 512 characters. */
  readonly description: string;
  /** The value each tier serves when no targeting rule matches. */
  readonly enabled: Readonly<Record<DeploymentTier, boolean>>;
}

export const featureFlags = {
  people: {
    key: "people-page",
    description:
      "Shows the People pages and serves the People dashboard API. Managed by Alchemy; dashboard edits are overwritten on deploy.",
    enabled: { local: true, preview: true, production: true },
  },
  chordCharts: {
    key: "chord-charts",
    description:
      "Shows the Songs pages (the song library and chord chart editor) and serves their API, which writes arrangement chord charts to Planning Center. Managed by Alchemy; dashboard edits are overwritten on deploy.",
    enabled: { local: true, preview: true, production: true },
  },
  practice: {
    key: "practice-view",
    description:
      "Shows a plan's Practice view (charts, lyrics, and rehearsal tracks for each song). Production serves it only to targeted users. Managed by Alchemy; dashboard edits are overwritten on deploy.",
    enabled: { local: true, preview: true, production: false },
  },
} as const satisfies Readonly<Record<FeatureFlagName, BooleanFeatureFlag>>;

export const deploymentTier = (stage: {
  readonly production: boolean;
  readonly local: boolean;
}): DeploymentTier => {
  if (stage.production) {
    return "production";
  }
  return stage.local ? "local" : "preview";
};
