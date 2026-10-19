import { featureFlags } from "@pcobooster/api/config/feature-flags";
import type { DeploymentTier } from "@pcobooster/api/config/feature-flags";
import { featureFlagNames } from "@pcobooster/contracts/features";
import type { FeatureFlagName } from "@pcobooster/contracts/features";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

type DeployedTier = Exclude<DeploymentTier, "local">;

/**
 * Targeting rules per tier, evaluated in ascending `priority` before the tier's default.
 * Conditions can match `userId` and `organizationId` (the Planning Center organization), and
 * a `rollout` buckets by user. For example, People for one organization in production:
 * `{ production: { people: [{ priority: 1, serveVariation: "on", conditions: [{ attribute:
 * "organizationId", operator: "equals", value: "<id>" }] }] } }`.
 */
const targetingRules: Partial<
  Record<
    DeployedTier,
    Partial<Record<FeatureFlagName, Cloudflare.Flagship.FlagRule[]>>
  >
> = {
  production: {
    // Jake Bodea's production user, to try Practice before everyone sees it.
    practice: [
      {
        priority: 1,
        serveVariation: "on",
        conditions: [
          {
            attribute: "userId",
            operator: "equals",
            value: "fur6vu90eJOhtJqLzwsgvbCBGxOsZTcI",
          },
        ],
      },
    ],
  },
};

const logicalId = (name: FeatureFlagName) =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)}Flag`;

/**
 * One Cloudflare Flagship app per deployed stage, holding one flag per entry in the registry
 * (`packages/api/src/config/feature-flags.ts`). Alchemy is the source of truth for every
 * flag's variations, default, and targeting rules: a deploy overwrites dashboard edits, so
 * change them here. The local stage declares none; see `worker.ts`.
 */
export const FeatureFlagApp = (tier: DeployedTier) =>
  Effect.gen(function* featureFlagApp() {
    const { stage } = yield* Alchemy.Stack;
    const app = yield* Cloudflare.Flagship.App("FeatureFlags", {
      name: `pcobooster-${stage}-flags`,
    });
    for (const name of featureFlagNames) {
      const definition = featureFlags[name];
      yield* Cloudflare.Flagship.Flag(logicalId(name), {
        appId: app.appId,
        key: definition.key,
        description: definition.description,
        variations: { off: false, on: true },
        defaultVariation: definition.enabled[tier] ? "on" : "off",
        rules: targetingRules[tier]?.[name] ?? [],
      });
    }
    return app;
  });
