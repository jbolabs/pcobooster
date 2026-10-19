import type {
  PlanningCenterRequestAccess,
  RequestAuthentication,
} from "@pcobooster/api/application/planning-center-access";
import { anonymousFeatureFlagSubject } from "@pcobooster/api/modules/feature-flags/feature-flags";
import type { FeatureFlagSubject } from "@pcobooster/api/modules/feature-flags/feature-flags";
import { Server } from "@pcobooster/api/server";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import type { FeatureFlagName } from "@pcobooster/contracts/features";
import { Effect } from "effect";

/** A demo visitor is anonymous; a signed-in user carries their selected account. */
export const featureFlagSubjectFor = (
  authentication: RequestAuthentication
): FeatureFlagSubject =>
  authentication.kind === "demo"
    ? anonymousFeatureFlagSubject
    : {
        userId: authentication.userId,
        planningCenterAccountId: authentication.accountId,
      };

/** What a flagged-off feature's procedures answer: as if the feature did not exist. */
const featureNotFound: Readonly<
  Record<
    FeatureFlagName,
    { readonly message: string; readonly resource: string }
  >
> = {
  people: {
    message: "People dashboard is not enabled.",
    resource: "people-dashboard",
  },
  chordCharts: {
    message: "The Songs pages are not enabled.",
    resource: "songs",
  },
  practice: {
    message: "The Practice view is not enabled.",
    resource: "practice",
  },
};

/** Fails with `NotFound` unless the flag is on for this caller. */
export const requireFeatureFlag = (
  access: PlanningCenterRequestAccess,
  name: FeatureFlagName
): Effect.Effect<void, NotFound, Server> =>
  Effect.gen(function* checkFeatureFlag() {
    const { featureFlags } = yield* Server;
    const enabled = yield* featureFlags.isEnabled(
      name,
      featureFlagSubjectFor(access.authentication)
    );
    if (!enabled) {
      yield* Effect.fail(new NotFound(featureNotFound[name]));
    }
  });
