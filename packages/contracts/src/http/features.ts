import type { FeatureFlagName } from "@pcobooster/contracts/features";
/** Which feature flags are on for this visitor. */
import { read } from "@pcobooster/contracts/http/endpoint";
import { plainGroup } from "@pcobooster/contracts/http/group";
import { Schema } from "effect";

/**
 * Whether each flag is on for this visitor; every flag is present, so a flag the API leaves out
 * fails decoding rather than reading as off.
 */
export const enabledFeaturesSchema = Schema.Struct({
  people: Schema.Boolean,
  chordCharts: Schema.Boolean,
  practice: Schema.Boolean,
} satisfies Record<FeatureFlagName, typeof Schema.Boolean>);

export const features = plainGroup(
  "features",
  read("status", "/features", {
    success: enabledFeaturesSchema,
  })
);
