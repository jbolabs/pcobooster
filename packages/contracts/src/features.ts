/**
 * Every feature flag by name. The API's registry (`packages/api/src/config/feature-flags.ts`)
 * must define exactly these, so the browser, the API, and Flagship cannot disagree.
 */
export const featureFlagNames = ["people", "chordCharts", "practice"] as const;

export type FeatureFlagName = (typeof featureFlagNames)[number];

/** Whether each flag is on for this visitor; every flag is present. */
export type EnabledFeatures = Record<FeatureFlagName, boolean>;
