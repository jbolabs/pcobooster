/**
 * A Worker whose requests share one isolate pacer with a single send permit, as every request
 * on a credential shares `PlanningCenterRatePacer` in production. Each request sends one
 * Planning Center request under the permit. Bundled into workerd by `send-permits.test.ts`.
 */
import { PlanningCenterRatePacer } from "@pcobooster/api/planning-center/rate-pacer";
import { Effect } from "effect";

interface FixtureBindings {
  readonly PLANNING_CENTER: {
    readonly fetch: (input: string) => Promise<Response>;
  };
}

const pacer = new PlanningCenterRatePacer({ maxInFlight: 1 });

export default {
  async fetch(request: Request, env: FixtureBindings): Promise<Response> {
    const name = new URL(request.url).searchParams.get("name") ?? "request";
    const body = await Effect.runPromise(
      pacer.withSendPermit(
        "credential",
        Effect.promise(async () => {
          const response = await env.PLANNING_CENTER.fetch(
            `http://planning-center/${name}`
          );
          return await response.text();
        })
      )
    );
    return new Response(body);
  },
};
