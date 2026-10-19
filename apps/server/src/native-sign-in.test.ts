import { createAuth } from "@pcobooster/api/auth";
import {
  createAppState,
  createPkcePair,
  createPlanningCenterStub,
  exchangeRun,
  parseExchange,
  runNativeSignIn,
  signInNatively,
} from "@pcobooster/api/auth/native-sign-in.fixture";
import type { PlanningCenterProfile } from "@pcobooster/api/auth/native-sign-in.fixture";
import { PLANNING_CENTER_SELECTED_ACCOUNT_HEADER } from "@pcobooster/api/auth/planning-center-session";
import { createDatabase } from "@pcobooster/api/db/client";
import { account } from "@pcobooster/api/db/schema";
import type { ServerDependencies } from "@pcobooster/api/server";
import {
  testFeatureFlags,
  testServer,
  testServerConfig,
} from "@pcobooster/api/testing/server";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createLocalD1 } from "../../../scripts/database/local-d1";
import { LOCAL_WORKER_TEST_TIMEOUT_MS } from "../../../scripts/testing/miniflare";
import { serveHttpForTest } from "./test-http";
import type { HttpAppTest } from "./test-http";

const { runtime, binding } = await createLocalD1("native-sign-in-app");
const database = createDatabase(binding);
const config = testServerConfig();
const origin = config.publicOrigin;
const planningCenter = createPlanningCenterStub(globalThis.fetch);

let app: HttpAppTest;
let server: ServerDependencies;
const featureFlags = testFeatureFlags();
const handler = async (request: Request): Promise<Response> =>
  await app.fetch(request);

const profile = (
  name: string,
  email = `${name}@example.com`
): PlanningCenterProfile => ({
  sub: `person-${name}`,
  email,
  organizationId: `org-${name}`,
  organizationName: `${name} Church`,
});

/** One product call as a native client makes it: identity only in HTTP headers. */
const callAs = async <Result>(
  headers: Readonly<Record<string, string>>,
  call: (client: ReturnType<HttpAppTest["client"]>) => Promise<Result>
): Promise<Result> => {
  const client = app.client({
    client: "expo",
    httpHeaders: () => headers,
  });
  return await call(client);
};

const isAuthenticated = async (
  headers: Readonly<Record<string, string>>
): Promise<boolean> => {
  const status = await callAs(
    headers,
    async (client) => await client.run((api) => api.session.status())
  );
  return status.authenticated;
};

const listAccounts = async (headers: Readonly<Record<string, string>>) =>
  await callAs(
    headers,
    async (client) => await client.run((api) => api.accounts.list())
  );

const accountIdFor = async (person: PlanningCenterProfile): Promise<string> => {
  const [row] = await database
    .select({ id: account.id })
    .from(account)
    .where(eq(account.accountId, person.sub));
  return row?.id ?? "";
};

const callAsAccount = async (headers: Record<string, string>) => {
  const client = app.client({
    client: "expo",
    httpHeaders: () => headers,
  });
  return await client.run((api) =>
    api.chordCharts.song({ params: { songId: "song-1" } })
  );
};

describe(
  "native sign-in through the API Worker",
  { timeout: LOCAL_WORKER_TEST_TIMEOUT_MS },
  () => {
    beforeAll(async () => {
      vi.stubGlobal("fetch", planningCenter.fetch);
      const auth = createAuth(config, database);
      await auth.$context;
      server = testServer({ config, database, auth, featureFlags });
      app = serveHttpForTest({ server });
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      await runtime.dispose();
    });

    it("hands the app a code through the Worker's auth routes", async () => {
      planningCenter.signInAs(profile("round-trip"));
      const run = await runNativeSignIn(handler, origin);
      const exchanged = await exchangeRun(handler, origin, run);

      expect([
        run.start.status,
        run.callback.status,
        exchanged.status,
      ]).toStrictEqual([302, 302, 200]);
      expect(run.redirect.protocol).toBe("pcobooster:");
      expect(run.redirect.searchParams.get("state")).toBe(run.appState);
      await expect(parseExchange(exchanged)).resolves.toHaveProperty("token");
    });

    it("authenticates identity calls with the bearer token", async () => {
      const person = profile("identity");
      planningCenter.signInAs(person);
      const { token, user, selectedAccountId } = await signInNatively(
        handler,
        origin
      );
      const authorization = `Bearer ${token}`;
      const listed = await listAccounts({ authorization });

      await expect(isAuthenticated({ authorization })).resolves.toBeTruthy();
      await expect(isAuthenticated({})).resolves.toBeFalsy();
      expect(listed.session).toStrictEqual({
        userId: user.id,
        name: "Jordan Example",
        email: person.email,
        image: null,
      });
      expect({
        selectedAccountId: listed.selectedAccountId,
        accounts: listed.accounts.map(({ id, identity }) => ({
          id,
          identity:
            identity === null
              ? null
              : { organizationName: identity.organizationName },
        })),
        demo: listed.demo,
      }).toStrictEqual({
        selectedAccountId,
        accounts: [
          {
            id: await accountIdFor(person),
            identity: { organizationName: person.organizationName },
          },
        ],
        demo: false,
      });
    });

    it("selects the organization the account header names, and only the caller's own", async () => {
      const graceChurch = profile("header-a", "header-select@example.com");
      const hopeChapel = profile("header-b", "header-select@example.com");
      const stranger = profile("someone-else");
      planningCenter.signInAs(graceChurch);
      await signInNatively(handler, origin);
      planningCenter.signInAs(hopeChapel);
      const { token } = await signInNatively(handler, origin);
      planningCenter.signInAs(stranger);
      await signInNatively(handler, origin);
      const [first, second, foreign] = await Promise.all(
        [graceChurch, hopeChapel, stranger].map(accountIdFor)
      );

      const selected = await Promise.all(
        [first, second, foreign].map(async (accountId) => {
          const listed = await listAccounts({
            authorization: `Bearer ${token}`,
            [PLANNING_CENTER_SELECTED_ACCOUNT_HEADER]: accountId ?? "",
          });
          return listed.selectedAccountId;
        })
      );

      // Another user's account is never selected: the caller falls back to their first one.
      expect(selected).toStrictEqual([first, second, first]);
    });

    it("authenticates Planning Center calls with the bearer token and selects the account the header names", async () => {
      const graceChurch = profile("http-a", "http-select@example.com");
      const hopeChapel = profile("http-b", "http-select@example.com");
      planningCenter.signInAs(graceChurch);
      await signInNatively(handler, origin);
      planningCenter.signInAs(hopeChapel);
      const { token } = await signInNatively(handler, origin);
      const [first, second] = await Promise.all(
        [graceChurch, hopeChapel].map(accountIdFor)
      );
      featureFlags.evaluations.length = 0;

      // The flag is off for everyone, so a signed-in caller gets NotFound after its flag check.
      await expect(
        callAsAccount({
          authorization: `Bearer ${token}`,
          [PLANNING_CENTER_SELECTED_ACCOUNT_HEADER]: first ?? "",
        })
      ).rejects.toBeInstanceOf(NotFound);
      await expect(
        callAsAccount({
          authorization: `Bearer ${token}`,
          [PLANNING_CENTER_SELECTED_ACCOUNT_HEADER]: second ?? "",
        })
      ).rejects.toBeInstanceOf(NotFound);
      await expect(callAsAccount({})).rejects.toBeInstanceOf(Unauthenticated);
      expect(
        featureFlags.evaluations.map(
          ({ subject }) => subject.planningCenterAccountId
        )
      ).toStrictEqual([first, second]);
    });

    it("limits the native start on every path Better Auth would serve it", async () => {
      const limitedApp = serveHttpForTest({
        server,
        allowAuthWrite: async () => await Promise.resolve(false),
      });
      const query = new URLSearchParams({
        code_challenge: createPkcePair().challenge,
        code_challenge_method: "S256",
        state: createAppState(),
        redirect_uri: "pcobooster://auth/callback",
      }).toString();
      const attempts = [
        ["GET", "/api/auth/native/start"],
        ["GET", "/api/auth/native/start/"],
        ["GET", "/api/auth//native/start"],
        ["GET", "/api/auth/native/%73tart"],
        ["GET", "/api/auth/Native/Start"],
        ["HEAD", "/api/auth/native/start"],
      ] as const;

      const statuses = await Promise.all(
        attempts.map(async ([method, path]) => {
          const response = await limitedApp.fetch(
            new Request(`${origin}${path}?${query}`, {
              method,
              headers: { "cf-connecting-ip": "203.0.113.7" },
            })
          );
          return response.status;
        })
      );

      // The limiter counts the exact path; Better Auth's router serves no other spelling of it.
      expect(statuses).toStrictEqual([429, 404, 404, 404, 404, 404]);
    });

    it("revokes the bearer token on sign-out", async () => {
      planningCenter.signInAs(profile("sign-out"));
      const { token } = await signInNatively(handler, origin);
      const authorization = `Bearer ${token}`;

      const signOut = await app.fetch(
        new Request(`${origin}/api/auth/sign-out`, {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: "{}",
        })
      );

      expect(signOut.status).toBe(200);
      await expect(isAuthenticated({ authorization })).resolves.toBeFalsy();
      await expect(listAccounts({ authorization })).rejects.toBeInstanceOf(
        Unauthenticated
      );
    });
  }
);
