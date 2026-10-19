import { createDatabase } from "@pcobooster/api/db/client";
import {
  account,
  activityEvents,
  analyticsErasureRequests,
  feedback,
  planningCenterAccountIdentities,
  session,
  user,
  verification,
} from "@pcobooster/api/db/schema";
import { deleteAccountData } from "@pcobooster/api/modules/account-deletion/delete-account-data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalD1 } from "../../../../../scripts/database/local-d1";

const { runtime, binding } = await createLocalD1("account-deletion");
const database = createDatabase(binding);
const now = new Date("2026-10-19T12:00:00.000Z");
const later = new Date("2026-10-26T12:00:00.000Z");

/** One person's rows in every table that can hold them. */
const seed = async (name: string) => {
  await database.insert(user).values({
    id: `${name}-user`,
    name,
    email: `${name}@example.com`,
    emailVerified: false,
  });
  await database.insert(account).values(
    ["a", "b"].map((suffix) => ({
      id: `${name}-account-${suffix}`,
      accountId: `${name}-person-${suffix}`,
      providerId: "planning-center",
      userId: `${name}-user`,
      accessToken: `${name}-access-${suffix}`,
      refreshToken: `${name}-refresh-${suffix}`,
      updatedAt: now,
    }))
  );
  await database.insert(planningCenterAccountIdentities).values(
    ["a", "b"].map((suffix) => ({
      accountId: `${name}-account-${suffix}`,
      providerAccountId: `${name}-person-${suffix}`,
      organizationId: `${name}-org-${suffix}`,
    }))
  );
  await database.insert(session).values({
    id: `${name}-session`,
    token: `${name}-token`,
    userId: `${name}-user`,
    expiresAt: later,
    updatedAt: now,
  });
  await database.insert(feedback).values({
    userId: `${name}-user`,
    message: `From ${name}`,
    path: "/",
  });
  await database.insert(activityEvents).values([
    { eventType: "auth_session_created", actorUserId: `${name}-user` },
    // Recorded with only the linked account, as some events are.
    { eventType: "schedule_attempt", actorAccountId: `${name}-account-b` },
  ]);
  await database.insert(verification).values({
    id: `${name}-handoff`,
    identifier: `native-sign-in:${name}-handoff`,
    value: JSON.stringify({
      sessionToken: `${name}-token`,
      userId: `${name}-user`,
      selectedAccountId: null,
      challenge: "c".repeat(43),
    }),
    expiresAt: later,
  });
};

const ids = (rows: readonly { readonly id: string }[]) =>
  rows.map((row) => row.id);

const remaining = async () => {
  const users = await database.select({ id: user.id }).from(user);
  const sessions = await database.select({ id: session.id }).from(session);
  const accounts = await database.select({ id: account.id }).from(account);
  const identities = await database
    .select({ id: planningCenterAccountIdentities.accountId })
    .from(planningCenterAccountIdentities);
  const feedbackRows = await database
    .select({ id: feedback.userId })
    .from(feedback);
  const activity = await database
    .select({
      type: activityEvents.eventType,
      user: activityEvents.actorUserId,
      account: activityEvents.actorAccountId,
    })
    .from(activityEvents);
  const verifications = await database
    .select({ id: verification.identifier })
    .from(verification);
  return {
    users: ids(users),
    sessions: ids(sessions),
    accounts: ids(accounts),
    identities: ids(identities),
    feedback: ids(feedbackRows),
    activity: activity.map(
      (row) => `${row.type}:${row.user ?? row.account ?? "none"}`
    ),
    verification: ids(verifications),
  };
};

describe(deleteAccountData, () => {
  beforeAll(async () => {
    await seed("leaving");
    await seed("staying");
    // Rows that belong to nobody in particular.
    await database.insert(activityEvents).values({
      eventType: "auth_sign_in_failed",
      personId: "planning-center-person-1",
    });
    await database.insert(verification).values({
      id: "oauth-state-1",
      identifier: "oauth-state-1",
      value: "not json, mentions leaving-user",
      expiresAt: later,
    });
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("deletes one person's rows in every table and nobody else's", async () => {
    await expect(
      deleteAccountData(database, "leaving-user", now)
    ).resolves.toStrictEqual({
      userDeleted: true,
      sessions: 1,
      accounts: 2,
      feedback: 1,
      activityEvents: 2,
      analyticsErasureQueued: true,
    });

    await expect(
      database
        .select({
          distinctId: analyticsErasureRequests.distinctId,
          requestedAt: analyticsErasureRequests.requestedAt,
          nextAttemptAt: analyticsErasureRequests.nextAttemptAt,
          passesCompleted: analyticsErasureRequests.passesCompleted,
        })
        .from(analyticsErasureRequests)
    ).resolves.toStrictEqual([
      {
        distinctId: "leaving-user",
        requestedAt: now,
        // One hour of grace for captures already in flight.
        nextAttemptAt: new Date("2026-10-19T13:00:00.000Z"),
        passesCompleted: 0,
      },
    ]);
    await expect(remaining()).resolves.toStrictEqual({
      users: ["staying-user"],
      sessions: ["staying-session"],
      accounts: ["staying-account-a", "staying-account-b"],
      identities: ["staying-account-a", "staying-account-b"],
      feedback: ["staying-user"],
      activity: [
        "auth_session_created:staying-user",
        "schedule_attempt:staying-account-b",
        "auth_sign_in_failed:none",
      ],
      verification: ["native-sign-in:staying-handoff", "oauth-state-1"],
    });
  });

  it("reports a user already deleted without failing", async () => {
    await expect(
      deleteAccountData(database, "leaving-user", now)
    ).resolves.toStrictEqual({
      userDeleted: false,
      sessions: 0,
      accounts: 0,
      feedback: 0,
      activityEvents: 0,
      analyticsErasureQueued: false,
    });
    // Still the one request from the first deletion.
    await expect(
      database
        .select({ distinctId: analyticsErasureRequests.distinctId })
        .from(analyticsErasureRequests)
    ).resolves.toStrictEqual([{ distinctId: "leaving-user" }]);
  });
});
