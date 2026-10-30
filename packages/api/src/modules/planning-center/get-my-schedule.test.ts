import { PlanningCenterRateLimitError } from "@pcobooster/api/planning-center/rate-limit-error";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { getMySchedulePage } from "./get-my-schedule";

describe("personal schedule pages", () => {
  it("returns personal assignments beyond the agenda window with continuation", async () => {
    const result = await Effect.runPromise(
      getMySchedulePage("person-7", 100, {
        getPersonAllSchedulesPage: (personId, offset) =>
          Effect.succeed({
            data: ["assignment-1"].map((id) => ({
              type: "Schedule",
              id,
              attributes: {
                sort_date: "2024-12-25T19:00:00Z",
                service_type_name: "Christmas",
                team_name: "Worship",
                team_position_name: `${personId}:${offset}`,
              },
              relationships: {
                plan: { data: { type: "Plan", id: "plan-9" } },
                service_type: { data: { type: "ServiceType", id: "type-2" } },
              },
            })),
            included: [],
            nextOffset: 200,
          }),
      })
    );
    expect(result).toStrictEqual({
      entries: [
        {
          planId: "plan-9",
          serviceTypeId: "type-2",
          serviceTypeName: "Christmas",
          sortDate: new Date("2024-12-25T19:00:00Z"),
          assignment: "Worship · person-7:100",
        },
      ],
      nextOffset: 200,
    });
  });

  it("skips inaccessible or undated plans while retaining the provider continuation", async () => {
    const result = await Effect.runPromise(
      getMySchedulePage("p", 0, {
        getPersonAllSchedulesPage: () =>
          Effect.succeed({
            data: [
              { id: "hidden", visible: false, date: "2020-01-01T19:00:00Z" },
              { id: "undated", visible: true, date: "" },
              { id: "invalid", visible: true, date: "not a date" },
            ].map(({ id, visible, date }) => ({
              type: "Schedule",
              id,
              attributes: { plan_visible_to_me: visible, sort_date: date },
              relationships: {
                plan: { data: { type: "Plan", id } },
                service_type: {
                  data: { type: "ServiceType", id: "service-1" },
                },
              },
            })),
            included: [],
            nextOffset: 100,
          }),
      })
    );
    expect(result).toStrictEqual({ entries: [], nextOffset: 100 });
  });

  it("keeps provider rate limits as failures instead of claiming an empty schedule", async () => {
    const result = await Effect.runPromise(
      getMySchedulePage("person-7", 0, {
        getPersonAllSchedulesPage: () =>
          Effect.fail(
            new PlanningCenterRateLimitError({
              retryAfterSeconds: 12,
              reason: "budget",
            })
          ),
      }).pipe(Effect.flip)
    );
    expect(result).toMatchObject({
      _tag: "PlanningCenterRateLimitError",
      retryAfterSeconds: 12,
      reason: "budget",
    });
  });
});
