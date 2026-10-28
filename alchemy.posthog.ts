import * as Cloudflare from "@alchemy.run/cloudflare";
/**
 * PostHog analytics configuration as code: project settings, dashboards, and saved
 * insights declared in `@pcobooster/analytics/reports`. Separate from the application
 * stack so analytics changes never need app secrets or a build.
 *
 *   bun run posthog:plan     # read-only diff against live PostHog
 *   bun run posthog:deploy   # apply after review
 */
import {
  dashboards,
  project as projectDefinition,
} from "@pcobooster/analytics/reports";
import * as Alchemy from "alchemy";
import type { Input } from "alchemy/Input";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Effect } from "effect";

import {
  PostHogDashboard,
  PostHogDashboardTiles,
  PostHogInsight,
  PostHogProject,
  postHogProviders,
} from "./scripts/posthog/resources";

const projectId = projectDefinition.id;

export default Alchemy.Stack(
  "pcobooster-posthog",
  { providers: postHogProviders, state: Cloudflare.state() },
  Effect.gen(function* analytics() {
    const stage = yield* Alchemy.Stage;
    if (stage !== "prod") {
      return yield* Effect.die(
        new Error(`PostHog configuration has only a prod stage: ${stage}`)
      );
    }
    yield* PostHogProject("Project", {
      projectId,
      settings: projectDefinition.settings,
    }).pipe(RemovalPolicy.retain());

    const dashboardIds: Record<string, Input<number>> = {};
    for (const definition of dashboards) {
      const dashboard = yield* PostHogDashboard(definition.key, {
        projectId,
        dashboardId: definition.id,
        name: definition.name,
        description: definition.description,
        pinned: definition.pinned,
        tags: definition.tags,
      }).pipe(RemovalPolicy.retain());
      // Literal IDs for adopted objects keep the plan able to read them before apply.
      const dashboardId = definition.id ?? dashboard.dashboardId;
      const insightIds: Input<number>[] = [];
      for (const insight of definition.insights) {
        const saved = yield* PostHogInsight(insight.key, {
          projectId,
          insightId: insight.id,
          name: insight.name,
          description: insight.description,
          favorited: insight.favorited,
          tags: insight.tags,
          query: insight.query,
          dashboardIds: [dashboardId],
        });
        insightIds.push(insight.id ?? saved.insightId);
      }
      yield* PostHogDashboardTiles(`${definition.key}Tiles`, {
        projectId,
        dashboardId,
        insightIds,
      });
      dashboardIds[definition.key] = dashboardId;
    }
    return { projectId, dashboardIds };
  })
);
