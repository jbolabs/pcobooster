/**
 * Schedule writes through the API Worker's router: assignment, removal, and status changes, each
 * audited with the request's real method and path, including after a disconnect.
 */
import {
  createRequestContext,
  RequestContext,
} from "@pcobooster/api/application/context";
import { provideAccess } from "@pcobooster/api/application/planning-center-access";
import type { PlanningCenterAccessDependencies } from "@pcobooster/api/application/planning-center-access";
import {
  commitScheduledPerson,
  prepareScheduledPerson,
  removeScheduledPerson,
  updateScheduledPersonStatus,
} from "@pcobooster/api/application/schedule";
import type { ActivityEventInput } from "@pcobooster/api/db/activity-events";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import {
  createPlanningCenterReadCaches,
  createPlanningCenterServices,
} from "@pcobooster/api/planning-center/services/factory";
import type { SuccessOf } from "@pcobooster/api/testing/effect";
import { unreachableHttpClient } from "@pcobooster/api/testing/http-client";
import { testServer } from "@pcobooster/api/testing/server";
import { AlreadyScheduled } from "@pcobooster/contracts/faults/already-scheduled";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { PositionMismatch } from "@pcobooster/contracts/faults/position-mismatch";
import { RateLimited } from "@pcobooster/contracts/faults/rate-limited";
import type { ScheduleAssignInput } from "@pcobooster/contracts/http/schedule";
import type { JsonValue } from "@pcobooster/planning-center-models/json";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { serveHttpForTest, TEST_API_ORIGIN } from "./test-http";

const input: ScheduleAssignInput = {
  serviceTypeId: "service-1",
  planId: "plan-1",
  personId: "person-1",
  teamId: "team-1",
  positionId: "position-1",
  oneOff: false,
};

const removalInput = {
  planPersonId: "plan-person-1",
  personId: "person-1",
  serviceTypeId: "service-1",
  planId: "plan-1",
};
/** The plan person's address in Planning Center: written through its plan. */
const LOCATION = {
  serviceTypeId: "service-1",
  planId: "plan-1",
  personId: "person-1",
};

const teamPositions = () => ({
  data: [
    {
      id: "position-1",
      type: "TeamPosition",
      attributes: { name: "Vocals" },
      relationships: { team: { data: { id: "team-1", type: "Team" } } },
    },
  ],
  included: [{ id: "team-1", type: "Team", attributes: { name: "Band" } }],
});

const callerHeaders = {
  "x-request-id": "request-1",
  "x-forwarded-for": "192.0.2.5",
  "user-agent": "test-agent",
};

const setup = () => {
  const services = createPlanningCenterServices(
    "schedule-test-token",
    "America/Los_Angeles",
    unreachableHttpClient,
    createPlanningCenterReadCaches(null)
  );
  const getTeamPositions = vi
    .spyOn(services.catalog, "getServiceTypeTeamPositionsWithTeams")
    .mockReturnValue(Effect.succeed(teamPositions()));
  vi.spyOn(services.people, "getPersonTeamPositionAssignments").mockReturnValue(
    Effect.succeed({
      data: [
        {
          id: "assignment-1",
          type: "PersonTeamPositionAssignment",
          attributes: {},
          relationships: {
            team_position: {
              data: { id: "position-1", type: "TeamPosition" },
            },
          },
        },
      ],
      included: [],
    })
  );
  const create = vi.spyOn(services.people, "createPlanPerson").mockReturnValue(
    Effect.succeed({
      id: "plan-person-1",
      type: "PlanPerson",
      attributes: { team_position_name: "Band - Vocals" },
    })
  );
  const remove = vi
    .spyOn(services.people, "deletePlanPerson")
    .mockReturnValue(Effect.void);
  const update = vi
    .spyOn(services.people, "updatePlanPersonStatus")
    .mockReturnValue(
      Effect.succeed({
        id: "plan-person-1",
        type: "PlanPerson",
        attributes: { status: "C" },
      })
    );
  const invalidate = vi.spyOn(services.people, "invalidateScheduleReadCaches");
  const authorize = vi
    .fn<PlanningCenterAccessDependencies["authorize"]>()
    .mockResolvedValue({
      kind: "account",
      userId: "user-1",
      accessToken: "schedule-test-token",
      accountId: "account-1",
      account: { id: "account-1", accountId: "provider-account-1" },
      scopes: ["services"],
    });
  const recordActivity = vi
    .fn<(event: ActivityEventInput) => Promise<void>>()
    .mockResolvedValue();
  const route = serveHttpForTest({
    server: testServer(),
    access: {
      authorize,
      createServices: () => services,
      presentationMode: () => false,
      presentationSeed: "test-seed",
    },
    scheduleAudit: { recordActivity },
  });
  const client = route.client({ httpHeaders: () => callerHeaders });
  return {
    services,
    route,
    client,
    recordActivity,
    create,
    remove,
    update,
    getTeamPositions,
    invalidate,
    authorize,
  };
};

const missingPlanPerson = () =>
  Effect.fail(new PlanningCenterApiError({ status: 404, message: "" }));

const ASSIGN_PATH = "/api/v1/service-types/service-1/plans/plan-1/team-members";

/** A raw assignment, to read the HTTP response the client does not expose. */
const rawAssign = (payload: JsonValue) =>
  new Request(`${TEST_API_ORIGIN}${ASSIGN_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pcobooster-client": "web;api=2",
      ...callerHeaders,
    },
    body: JSON.stringify(payload),
  });

describe("schedule writes", () => {
  it("uses the request cache scope for each mutation and hides duplicate details in presentation mode", async () => {
    const { services, authorize, create } = setup();
    const request = new Request(`${TEST_API_ORIGIN}${ASSIGN_PATH}`, {
      method: "POST",
    });
    const authentication = await authorize(request);
    const access = {
      authentication,
      services,
      cacheScope: services.core.getCacheScope(),
      presentation: true,
      presentationSeed: "test-seed",
    };
    const invalidateWindowRosters = vi.spyOn(
      services.people,
      "invalidatePlanWindowRosters"
    );
    const withRequestContext = <Value, Failure>(
      program: Effect.Effect<Value, Failure, RequestContext>
    ) =>
      Effect.provideService(
        program,
        RequestContext,
        createRequestContext(request)
      );
    const prepareAssignment = async () =>
      await Effect.runPromise(
        withRequestContext(provideAccess(prepareScheduledPerson(input), access))
      );
    const commitAssignment = async (
      preparation: Awaited<ReturnType<typeof prepareAssignment>>
    ) =>
      await Effect.runPromise(
        withRequestContext(
          provideAccess(commitScheduledPerson(input, preparation), access)
        )
      );
    await commitAssignment(await prepareAssignment());
    await Effect.runPromise(
      withRequestContext(
        provideAccess(removeScheduledPerson(removalInput), access)
      )
    );
    await Effect.runPromise(
      withRequestContext(
        provideAccess(
          updateScheduledPersonStatus({ ...removalInput, status: "C" }),
          access
        )
      )
    );
    create.mockReturnValueOnce(
      Effect.fail(
        new PlanningCenterApiError({
          status: 422,
          message: "Person has already been scheduled for this position",
        })
      )
    );
    const duplicatePreparation = await prepareAssignment();
    const duplicate = await Effect.runPromise(
      Effect.result(
        withRequestContext(
          provideAccess(
            commitScheduledPerson(input, duplicatePreparation),
            access
          )
        )
      )
    );
    expect(duplicate).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "AlreadyScheduled", details: undefined },
    });
    expect(invalidateWindowRosters).toHaveBeenCalledTimes(4);
  });

  it("assigns with the authorized services and records complete activity context", async () => {
    const { route, client, recordActivity, create, authorize } = setup();

    await expect(
      client.run((api) =>
        api.schedule.assign({ params: input, payload: input })
      )
    ).resolves.toStrictEqual({
      success: true,
      data: { id: "plan-person-1" },
    });
    const raw = await route.fetch(rawAssign(input));

    expect({
      authorizations: authorize.mock.calls.length,
      cacheControl: raw.headers.get("cache-control"),
    }).toStrictEqual({ authorizations: 2, cacheControl: "private, no-store" });
    expect(create).toHaveBeenCalledWith(
      "service-1",
      "person-1",
      "plan-1",
      "team-1",
      "Vocals"
    );
    expect(recordActivity).toHaveBeenNthCalledWith(1, {
      requestId: "request-1",
      path: ASSIGN_PATH,
      method: "POST",
      ipAddress: "192.0.2.5",
      userAgent: "test-agent",
      eventType: "schedule_attempt",
      actorUserId: "user-1",
      actorAccountId: "account-1",
      success: true,
      statusCode: 200,
      errorCode: null,
      serviceTypeId: "service-1",
      personId: "person-1",
      planId: "plan-1",
      teamId: "team-1",
      positionId: "position-1",
      metadata: { planPersonId: "plan-person-1", oneOff: false },
    });
  });

  it("defaults oneOff to false when the caller leaves it out", async () => {
    const { route, recordActivity } = setup();
    const { oneOff: _oneOff, ...withoutOneOff } = input;

    const raw = await route.fetch(rawAssign(withoutOneOff));

    expect(raw.status).toBe(200);
    expect(recordActivity).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        metadata: { planPersonId: "plan-person-1", oneOff: false },
      })
    );
  });

  it("rejects invalid input before a provider mutation or an audit row, after access resolves", async () => {
    const { route, recordActivity, create, authorize } = setup();

    const raw = await route.fetch(rawAssign({ ...input, teamId: " " }));

    expect(raw.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
    // HttpApi decodes inside its middleware, so the session resolves first (accepted).
    expect(authorize).toHaveBeenCalledOnce();
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("preserves the already-scheduled conflict and refreshes scoped reads", async () => {
    const { client, recordActivity, create, invalidate } = setup();
    create.mockReturnValue(
      Effect.fail(
        new PlanningCenterApiError({
          status: 422,
          message: "Person has already been scheduled for this position",
        })
      )
    );

    const assignment = client.run((api) =>
      api.schedule.assign({ params: input, payload: input })
    );

    await expect(assignment).rejects.toBeInstanceOf(AlreadyScheduled);
    await expect(assignment).rejects.toMatchObject({
      details: "Person has already been scheduled for this position",
    });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(input);
    expect(recordActivity).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        success: false,
        statusCode: 409,
        errorCode: "ALREADY_SCHEDULED",
      })
    );
  });

  it("returns the created assignment and selected position on a partial-success mismatch", async () => {
    const { client, recordActivity, create } = setup();
    create.mockReturnValue(
      Effect.succeed({
        id: "created-mismatch",
        type: "PlanPerson",
        attributes: { team_position_name: "Band - Drums" },
      })
    );

    const assignment = client.run((api) =>
      api.schedule.assign({ params: input, payload: input })
    );

    await expect(assignment).rejects.toBeInstanceOf(PositionMismatch);
    await expect(assignment).rejects.toMatchObject({
      details: {
        selected: {
          teamId: "team-1",
          teamName: "Band",
          positionId: "position-1",
          positionName: "Vocals",
        },
        created: {
          planPersonId: "created-mismatch",
          teamPositionName: "Band - Drums",
        },
      },
    });
    expect(recordActivity).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        success: false,
        statusCode: 409,
        errorCode: "POSITION_MISMATCH",
        metadata: {
          selectedTeamName: "Band",
          selectedPositionName: "Vocals",
          createdTeamPositionName: "Band - Drums",
          planPersonId: "created-mismatch",
        },
      })
    );
  });

  it("removes and changes status with request-owned services and audit metadata", async () => {
    const { client, recordActivity, remove, update } = setup();

    const removed = await client.run((api) =>
      api.schedule.remove({ params: removalInput, query: removalInput })
    );
    const updated = await client.run((api) =>
      api.schedule.updateStatus({
        params: { ...removalInput },
        payload: { ...removalInput, status: "D" },
      })
    );

    expect({ removed, updated }).toStrictEqual({
      removed: { success: true },
      updated: { success: true },
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith("plan-person-1", LOCATION);
    expect(update).toHaveBeenCalledExactlyOnceWith(
      "plan-person-1",
      "D",
      LOCATION
    );
    expect(recordActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: "schedule_remove",
        success: true,
        metadata: removalInput,
      })
    );
    expect(recordActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: "schedule_status_change",
        success: true,
        metadata: { ...removalInput, status: "D" },
      })
    );
  });

  it("reports a plan person Planning Center no longer has as not found", async () => {
    const { client, recordActivity, remove, update } = setup();
    remove.mockReturnValueOnce(missingPlanPerson());
    update.mockReturnValueOnce(missingPlanPerson());
    const target = {
      planPersonId: "plan-person-1",
      serviceTypeId: "service-1",
      planId: "plan-1",
    };

    const removal = client.run((api) =>
      api.schedule.remove({ params: target, query: target })
    );
    const statusChange = client.run((api) =>
      api.schedule.updateStatus({
        params: { ...target },
        payload: { ...target, status: "C" },
      })
    );

    await expect(removal).rejects.toBeInstanceOf(NotFound);
    await expect(removal).rejects.toMatchObject({ resource: "plan-person" });
    await expect(statusChange).rejects.toMatchObject({
      _tag: "NotFound",
      resource: "plan-person",
    });
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCode: "NOT_FOUND" })
    );
  });

  it("logs an audit persistence failure with the procedure and request it ran in", async () => {
    const { route, client, recordActivity } = setup();
    recordActivity.mockRejectedValueOnce(new Error("database unavailable"));

    await client.run((api) =>
      api.schedule.assign({ params: input, payload: input })
    );

    expect(
      route.logs.find(
        (line) => line.message === "Failed to record scheduling activity event"
      )
    ).toMatchObject({
      level: "warn",
      fields: {
        procedure: "schedule.assign",
        requestId: "request-1",
        method: "POST",
        path: ASSIGN_PATH,
        error: "database unavailable",
      },
    });
  });

  it("maps provider failure and keeps audit persistence failure from changing a successful mutation", async () => {
    const { client, recordActivity, create } = setup();
    create.mockReturnValueOnce(
      Effect.fail(
        new PlanningCenterApiError({
          status: 429,
          message: "Rate limited",
          retryAfterSeconds: 5,
        })
      )
    );

    const limited = client.run((api) =>
      api.schedule.assign({ params: input, payload: input })
    );

    await expect(limited).rejects.toBeInstanceOf(RateLimited);
    await expect(limited).rejects.toMatchObject({ retryAfterSeconds: 5 });
    expect(recordActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        success: false,
        statusCode: 429,
        errorCode: "TOO_MANY_REQUESTS",
      })
    );
    recordActivity.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      client.run((api) =>
        api.schedule.assign({ params: input, payload: input })
      )
    ).resolves.toMatchObject({
      success: true,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("cancels interruptible assignment preflight without starting a provider write", async () => {
    const { client, recordActivity, create, getTeamPositions } = setup();
    const controller = new AbortController();
    const preflight =
      Promise.withResolvers<SuccessOf<typeof getTeamPositions>>();
    getTeamPositions.mockReturnValueOnce(
      Effect.promise(async () => await preflight.promise)
    );

    const pending = client.run(
      (api) => api.schedule.assign({ params: input, payload: input }),
      {
        signal: controller.signal,
      }
    );
    await vi.waitFor(() => {
      expect(getTeamPositions).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => {
      expect(recordActivity).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          success: false,
          statusCode: 499,
          errorCode: "CLIENT_CLOSED_REQUEST",
        })
      );
    });
    preflight.resolve(teamPositions());
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "assignment",
      async (client: ReturnType<typeof setup>["client"], signal: AbortSignal) =>
        await client.run(
          (api) => api.schedule.assign({ params: input, payload: input }),
          { signal }
        ),
    ],
    [
      "removal",
      async (client: ReturnType<typeof setup>["client"], signal: AbortSignal) =>
        await client.run(
          (api) =>
            api.schedule.remove({ params: removalInput, query: removalInput }),
          { signal }
        ),
    ],
    [
      "status update",
      async (client: ReturnType<typeof setup>["client"], signal: AbortSignal) =>
        await client.run(
          (api) =>
            api.schedule.updateStatus({
              params: { ...removalInput },
              payload: { ...removalInput, status: "C" },
            }),
          { signal }
        ),
    ],
  ] as const)(
    "waits for an in-flight %s before recording success after disconnect",
    async (_name, send) => {
      const { client, recordActivity, create, remove, update } = setup();
      const controller = new AbortController();
      const completion = Promise.withResolvers<null>();
      const disconnectThenFinish = Effect.promise(async () => {
        controller.abort();
        await completion.promise;
      });
      create.mockReturnValueOnce(
        Effect.as(disconnectThenFinish, {
          id: "plan-person-1",
          type: "PlanPerson",
          attributes: { team_position_name: "Band - Vocals" },
        })
      );
      remove.mockReturnValueOnce(disconnectThenFinish);
      update.mockReturnValueOnce(
        Effect.as(disconnectThenFinish, {
          id: "plan-person-1",
          type: "PlanPerson",
          attributes: { status: "C" },
        })
      );

      const pending = send(client, controller.signal);

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(recordActivity).not.toHaveBeenCalled();
      completion.resolve(null);
      await vi.waitFor(() => {
        expect(recordActivity).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ success: true, errorCode: null })
        );
      });
    }
  );
});
