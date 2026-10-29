import { createAuth } from "@pcobooster/api/auth";
import { createDatabase } from "@pcobooster/api/db/client";
import {
  account,
  activityEvents,
  planningCenterAccountIdentities,
  session,
  user,
} from "@pcobooster/api/db/schema";
import { testServerConfig } from "@pcobooster/api/testing/server";
import { makeSignature } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalD1 } from "../../../../scripts/database/local-d1";

const { runtime, binding } = await createLocalD1("d1-tests");
const database = createDatabase(binding);
const createdAt = new Date("2026-09-18T19:52:51.123Z");

describe("D1 persistence", () => {
  beforeAll(async () => {
    await database.insert(user).values({
      id: "preserved-user",
      name: "Migration Test",
      email: "migration@example.com",
      emailVerified: false,
      createdAt,
      updatedAt: createdAt,
    });
    await database.insert(account).values({
      id: "preserved-account",
      accountId: "provider-account",
      providerId: "planning-center",
      userId: "preserved-user",
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      accessTokenExpiresAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
    await database.insert(session).values({
      id: "preserved-session",
      token: "test-session-token",
      userId: "preserved-user",
      expiresAt: new Date(Date.now() + 86_400_000),
      updatedAt: createdAt,
    });
    await database.insert(planningCenterAccountIdentities).values({
      accountId: "preserved-account",
      providerAccountId: "provider-account",
      organizationId: "test-organization",
      fetchedAt: createdAt,
    });
    await database.insert(activityEvents).values([
      {
        id: 42,
        eventType: "auth_session_created",
        actorUserId: "preserved-user",
        createdAt: new Date(),
        success: false,
        metadata: { imported: true, details: { count: 2 } },
      },
    ]);
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("preserves millisecond dates, false booleans, JSON, tokens, and imported IDs", async () => {
    const storedUser = await database.query.user.findFirst();
    const storedAccount = await database.query.account.findFirst();
    const event = await database.query.activityEvents.findFirst({
      where: { id: 42 },
    });
    expect(storedUser).toMatchObject({ createdAt, emailVerified: false });
    expect(storedAccount).toMatchObject({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      accessTokenExpiresAt: createdAt,
    });
    expect(event).toMatchObject({
      success: false,
      metadata: { imported: true, details: { count: 2 } },
    });
    const inserted = await database
      .insert(activityEvents)
      .values({ eventType: "schedule_attempt" })
      .returning();
    expect(inserted[0].id).toBeGreaterThan(42);
    expect(inserted[0].metadata).toStrictEqual({});
  });

  it("initializes Better Auth with D1 and safely handles an unsigned request", async () => {
    const auth = createAuth(testServerConfig(), database);
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session")
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toBeNull();
  });

  it("accepts a preserved signed session without requiring a new sign-in", async () => {
    const signature = await makeSignature(
      "test-session-token",
      "pcobooster-unit-test-secret-with-no-production-access"
    );
    const auth = createAuth(testServerConfig(), database);
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: {
          cookie: `better-auth.session_token=${encodeURIComponent(`test-session-token.${signature}`)}`,
        },
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: { id: "preserved-user" },
      session: { id: "preserved-session" },
    });
  });

  it("enforces foreign keys", async () => {
    await expect(
      binding
        .prepare(
          "INSERT INTO session (id, token, userId, expiresAt, updatedAt) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(
          "orphan-session",
          "orphan-token",
          "missing-user",
          Date.now(),
          Date.now()
        )
        .run()
    ).rejects.toThrow("FOREIGN KEY constraint failed");
  });
});
