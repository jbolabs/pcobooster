/**
 * Deleting your own account through the API Worker: real Better Auth sessions on local D1,
 * Planning Center sign-in through a stub, and the router a native or web client calls.
 */
import { createAuth } from "@pcobooster/api/auth";
import { demoSessionToken } from "@pcobooster/api/auth/demo-access";
import {
  createPlanningCenterStub,
  exchangeRun,
  runNativeSignIn,
  signInNatively,
} from "@pcobooster/api/auth/native-sign-in.fixture";
import type { PlanningCenterProfile } from "@pcobooster/api/auth/native-sign-in.fixture";
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
import { saveFeedback } from "@pcobooster/api/modules/feedback/save-feedback";
import type { ServerDependencies } from "@pcobooster/api/server";
import { testServer, testServerConfig } from "@pcobooster/api/testing/server";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import { count, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createLocalD1 } from "../../../scripts/database/local-d1";
import { LOCAL_WORKER_TEST_TIMEOUT_MS } from "../../../scripts/testing/miniflare";
import { serveHttpForTest } from "./test-http";
import type { HttpAppTest } from "./test-http";

const { runtime, binding } = await createLocalD1("user-deletion-app");
const database = createDatabase(binding);
const DEMO_KEY = "demo-link-key-long-enough-to-pass-0000";
const config = testServerConfig({
  DEMO_ACCESS_KEY: DEMO_KEY,
  DEMO_PLANNING_CENTER_CLIENT: "demo-client",
  DEMO_PLANNING_CENTER_PAT: "demo-pat",
});
const { publicOrigin: origin } = config;
const planningCenter = createPlanningCenterStub(globalThis.fetch);

let app: HttpAppTest;
let server: ServerDependencies;
const handler = async (request: Request): Promise<Response> =>
  await app.fetch(request);

const profile = (name: string): PlanningCenterProfile => ({
  sub: `person-${name}`,
  email: `${name}@example.com`,
  organizationId: `org-${name}`,
  organizationName: `${name} Church`,
});

const clientWith = (headers: Readonly<Record<string, string>>) =>
  app.client({ client: "expo", httpHeaders: () => headers });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Signs in natively and sends one piece of feedback, as a real person would leave data. */
const signUp = async (name: string) => {
  planningCenter.signInAs(profile(name));
  const signedIn = await signInNatively(handler, origin);
  await clientWith(bearer(signedIn.token)).run((api) =>
    api.feedback.submit({
      payload: { message: `Hello from ${name}`, path: "/", sessionId: null },
    })
  );
  return signedIn;
};

const isAuthenticated = async (token: string): Promise<boolean> => {
  const status = await clientWith(bearer(token)).run((api) =>
    api.session.status()
  );
  return status.authenticated;
};

const total = async (
  query: Promise<readonly { readonly rows: number }[]>
): Promise<number> => {
  const [row] = await query;
  return row?.rows ?? 0;
};

/** Every row pcobooster.com keeps for one user, per table. */
const rowsFor = async (userId: string) => {
  const accountRows = await database
    .select({ id: account.id })
    .from(account)
    .where(eq(account.userId, userId));
  const accountIds = accountRows.map((row) => row.id);
  const handoffs = await database
    .select({ value: verification.value })
    .from(verification)
    .where(like(verification.identifier, "native-sign-in:%"));
  return {
    user: await total(
      database.select({ rows: count() }).from(user).where(eq(user.id, userId))
    ),
    sessions: await total(
      database
        .select({ rows: count() })
        .from(session)
        .where(eq(session.userId, userId))
    ),
    accounts: accountIds.length,
    identities: await total(
      database
        .select({ rows: count() })
        .from(planningCenterAccountIdentities)
        .where(inArray(planningCenterAccountIdentities.accountId, accountIds))
    ),
    feedback: await total(
      database
        .select({ rows: count() })
        .from(feedback)
        .where(eq(feedback.userId, userId))
    ),
    activity: await total(
      database
        .select({ rows: count() })
        .from(activityEvents)
        .where(eq(activityEvents.actorUserId, userId))
    ),
    handoffs: handoffs.filter((row) => row.value.includes(`"${userId}"`))
      .length,
  };
};

/** Open PostHog erasure requests for a user id (`analytics_erasure_requests`). */
const erasuresFor = async (userId: string) =>
  await total(
    database
      .select({ rows: count() })
      .from(analyticsErasureRequests)
      .where(eq(analyticsErasureRequests.distinctId, userId))
  );

const nothing = {
  user: 0,
  sessions: 0,
  accounts: 0,
  identities: 0,
  feedback: 0,
  activity: 0,
  handoffs: 0,
};

describe(
  "deleting your own account through the API Worker",
  { timeout: LOCAL_WORKER_TEST_TIMEOUT_MS },
  () => {
    beforeAll(async () => {
      vi.stubGlobal("fetch", planningCenter.fetch);
      const auth = createAuth(config, database);
      await auth.$context;
      server = testServer({ config, database, auth });
      app = serveHttpForTest({ server });
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      await runtime.dispose();
    });

    it("deletes everything the caller owns, ends every session, and leaves other people alone", async () => {
      const deleting = await signUp("leaving");
      // A second device signed in, and a third sign-in waiting to be exchanged.
      planningCenter.signInAs(profile("leaving"));
      const otherDevice = await signInNatively(handler, origin);
      planningCenter.signInAs(profile("leaving"));
      const pending = await runNativeSignIn(handler, origin);
      const staying = await signUp("staying");
      const stayingBefore = await rowsFor(staying.user.id);

      await expect(rowsFor(deleting.user.id)).resolves.toStrictEqual({
        user: 1,
        sessions: 3,
        accounts: 1,
        identities: 1,
        feedback: 1,
        // Three sessions created and one account linked.
        activity: 4,
        handoffs: 1,
      });

      await expect(
        clientWith(bearer(deleting.token)).run((api) => api.user.delete())
      ).resolves.toStrictEqual({ deleted: true });

      const pendingExchange = await exchangeRun(handler, origin, pending);
      expect({
        deletedRows: await rowsFor(deleting.user.id),
        thisDevice: await isAuthenticated(deleting.token),
        otherDevice: await isAuthenticated(otherDevice.token),
        pendingExchange: pendingExchange.status,
        stayingRows: await rowsFor(staying.user.id),
        staying: await isAuthenticated(staying.token),
        // PostHog's copy is erased later (`analytics-erasure.ts`), owed from the same batch.
        erasures: {
          deleted: await erasuresFor(deleting.user.id),
          staying: await erasuresFor(staying.user.id),
        },
      }).toStrictEqual({
        deletedRows: nothing,
        thisDevice: false,
        otherDevice: false,
        pendingExchange: 400,
        stayingRows: stayingBefore,
        staying: true,
        erasures: { deleted: 1, staying: 0 },
      });
    });

    it("starts a new, empty account when the same Planning Center person signs in again", async () => {
      const first = await signUp("returning");
      await clientWith(bearer(first.token)).run((api) => api.user.delete());

      planningCenter.signInAs(profile("returning"));
      const again = await signInNatively(handler, origin);

      const returned = await rowsFor(again.user.id);
      expect(again.user.id).not.toBe(first.user.id);
      await expect(rowsFor(first.user.id)).resolves.toStrictEqual(nothing);
      expect(returned.feedback).toBe(0);
    });

    it("refuses a caller with no session, or an unsigned token, and deletes nothing", async () => {
      const person = await signUp("unsigned");
      const before = await rowsFor(person.user.id);
      const [rawToken = ""] = person.token.split(".");

      await expect(
        clientWith({}).run((api) => api.user.delete())
      ).rejects.toBeInstanceOf(Unauthenticated);
      await expect(
        clientWith(bearer(rawToken)).run((api) => api.user.delete())
      ).rejects.toBeInstanceOf(Unauthenticated);

      await expect(rowsFor(person.user.id)).resolves.toStrictEqual(before);
      await expect(erasuresFor(person.user.id)).resolves.toBe(0);
    });

    it("refuses the read-only demo, even alongside a real session", async () => {
      const person = await signUp("demo-visitor");
      const before = await rowsFor(person.user.id);
      const demoToken =
        config.demo === null ? "" : demoSessionToken(config.demo);

      await expect(
        clientWith({
          ...bearer(person.token),
          "x-pcobooster-demo": demoToken,
        }).run((api) => api.user.delete())
      ).rejects.toBeInstanceOf(Forbidden);

      await expect(rowsFor(person.user.id)).resolves.toStrictEqual(before);
    });

    it("refuses the local API's own sign-in", async () => {
      const person = await signUp("local-api");
      const before = await rowsFor(person.user.id);
      const local = serveHttpForTest({
        server: testServer({
          config: { ...config, devAuthBypass: true },
          database,
          auth: server.auth,
        }),
      });

      await expect(
        local
          .client({ client: "expo", httpHeaders: () => bearer(person.token) })
          .run((api) => api.user.delete())
      ).rejects.toBeInstanceOf(Forbidden);

      await expect(rowsFor(person.user.id)).resolves.toStrictEqual(before);
    });

    it("rejects a cached browser session after native deletion without recreating feedback", async () => {
      const person = await signUp("cached-browser");
      const tokenCookie = `better-auth.session_token=${encodeURIComponent(person.token)}`;
      const response = await app.fetch(
        new Request(`${origin}/api/auth/get-session`, {
          headers: { cookie: tokenCookie },
        })
      );
      const cachedCookie = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("better-auth.session_data="));
      expect(response.status).toBe(200);
      expect(cachedCookie).toMatch(/^better-auth\.session_data=.+/u);
      if (cachedCookie === undefined) {
        throw new Error(
          "Better Auth did not issue a signed session cache cookie"
        );
      }
      const browser = clientWith({
        cookie: `${tokenCookie}; ${cachedCookie.split(";")[0]}`,
      });
      await clientWith(bearer(person.token)).run((api) => api.user.delete());
      await expect(
        browser.run((api) =>
          api.feedback.submit({
            payload: {
              message: "Must not resurrect me",
              path: "/",
              sessionId: null,
            },
          })
        )
      ).rejects.toBeInstanceOf(Unauthenticated);
      await expect(rowsFor(person.user.id)).resolves.toStrictEqual(nothing);
    });

    it("cannot save feedback if deletion wins after the request authenticated", async () => {
      const person = await signUp("in-flight-feedback");
      await clientWith(bearer(person.token)).run((api) => api.user.delete());
      // The write stage of a request whose earlier authentication identified this user.
      await expect(
        saveFeedback(database, {
          userId: person.user.id,
          message: "Authenticated before deletion",
          path: "/",
          sessionId: null,
          userAgent: "in-flight-browser",
        })
      ).rejects.toThrow("Feedback insert returned no row");
      await expect(rowsFor(person.user.id)).resolves.toStrictEqual(nothing);
    });

    it("expires a browser caller's session cookies", async () => {
      const person = await signUp("browser");
      const response = await app.fetch(
        new Request(`${origin}/api/v1/user`, {
          method: "DELETE",
          headers: {
            cookie: `better-auth.session_token=${encodeURIComponent(person.token)}`,
            "x-pcobooster-client": "web;api=2",
          },
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toStrictEqual([
        "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
        "better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
        "better-auth.dont_remember=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
        `better-auth.session_token_device-${person.user.id}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
        "pco-selected-account-id=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
      ]);
      await expect(rowsFor(person.user.id)).resolves.toStrictEqual(nothing);
    });
  }
);
