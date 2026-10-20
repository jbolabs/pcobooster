import { createDatabase } from "@pcobooster/api/db/client";
import { activityEvents, user } from "@pcobooster/api/db/schema";
import { deleteAccountData } from "@pcobooster/api/modules/account-deletion/delete-account-data";
import { afterAll, describe, expect, it } from "vitest";

import { createLocalD1 } from "../../../../scripts/database/local-d1";
import { recordActivityEvent } from "./activity-events";

const { runtime, binding } = await createLocalD1("activity-deletion-race");
const database = createDatabase(binding);
const recorder = { database, config: { postHogProjectKey: null } };

describe("activity recording after account deletion", () => {
  afterAll(async () => {
    await runtime.dispose();
  });

  it("skips a deleted actor while retaining other people's and anonymous events", async () => {
    await database.insert(user).values([
      {
        id: "leaving",
        name: "Leaving",
        email: "leaving@example.test",
        emailVerified: true,
      },
      {
        id: "staying",
        name: "Staying",
        email: "staying@example.test",
        emailVerified: true,
      },
    ]);
    await recordActivityEvent(recorder, {
      eventType: "schedule_attempt",
      actorUserId: "leaving",
      planId: "before",
    });
    await deleteAccountData(
      database,
      "leaving",
      new Date("2026-10-19T12:00:00Z")
    );
    await recordActivityEvent(recorder, {
      eventType: "schedule_attempt",
      actorUserId: "leaving",
      planId: "late",
    });
    await recordActivityEvent(recorder, {
      eventType: "schedule_attempt",
      actorUserId: "staying",
      planId: "retained",
      success: true,
      metadata: { result: "scheduled" },
    });
    await recordActivityEvent(recorder, {
      eventType: "auth_sign_in_failed",
      planId: "anonymous",
    });
    const rows = await database
      .select({
        userId: activityEvents.actorUserId,
        planId: activityEvents.planId,
        success: activityEvents.success,
        metadata: activityEvents.metadata,
      })
      .from(activityEvents);
    expect(rows).toStrictEqual([
      {
        userId: "staying",
        planId: "retained",
        success: true,
        metadata: { result: "scheduled" },
      },
      { userId: null, planId: "anonymous", success: null, metadata: {} },
    ]);
  });
});
