import { createAuth } from "@pcobooster/api/auth";
import {
  NATIVE_HANDOFF_TTL_SECONDS,
  NATIVE_REDIRECT_URIS,
} from "@pcobooster/api/auth/native-sign-in";
import {
  callbackFor,
  cookieHeader,
  createAppState,
  createPkcePair,
  createPlanningCenterStub,
  exchangeNativeCode,
  exchangeRun,
  parseExchange,
  runNativeSignIn,
  setCookieNamed,
  startNativeSignIn,
} from "@pcobooster/api/auth/native-sign-in.fixture";
import type {
  ExchangeRequestBody,
  NativeSignInRun,
  PlanningCenterProfile,
} from "@pcobooster/api/auth/native-sign-in.fixture";
import { PLANNING_CENTER_SELECTED_ACCOUNT_COOKIE } from "@pcobooster/api/auth/planning-center-session";
import { createDatabase } from "@pcobooster/api/db/client";
import {
  account,
  activityEvents,
  session,
  user,
  verification,
} from "@pcobooster/api/db/schema";
import { testServerConfig } from "@pcobooster/api/testing/server";
import { and, eq, like } from "drizzle-orm";
import { Schema } from "effect";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createLocalD1 } from "../../../../scripts/database/local-d1";
import { LOCAL_WORKER_TEST_TIMEOUT_MS } from "../../../../scripts/testing/miniflare";

const { runtime, binding } = await createLocalD1("native-sign-in");
const database = createDatabase(binding);
const config = testServerConfig();
const origin = config.publicOrigin;
const planningCenter = createPlanningCenterStub(globalThis.fetch);

const SESSION_COOKIE = "better-auth.session_token";
const SESSION_DATA_COOKIE = "better-auth.session_data";
const STATE_COOKIE = "better-auth.state";
const MARKER_COOKIE = "better-auth.native_sign_in";
const APP_REDIRECT_URI = "pcobooster://auth/callback";
const HANDOFF_CODE = /^[\w-]{43}$/u;
const MILLISECONDS_PER_SECOND = 1000;
const SESSION_REFRESH_AFTER_MS = 2 * 24 * 60 * 60 * MILLISECONDS_PER_SECOND;

const decodeErrorBody = Schema.decodeUnknownSync(
  Schema.Struct({ code: Schema.String })
);
const decodeMarkerFields = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.String)
);
const decodeSessionBody = Schema.decodeUnknownSync(
  Schema.NullOr(Schema.Struct({ user: Schema.Struct({ id: Schema.String }) }))
);
const decodeSignInResponse = Schema.decodeUnknownSync(
  Schema.Struct({ url: Schema.String })
);

let auth: ReturnType<typeof createAuth>;
const handler = async (request: Request): Promise<Response> =>
  await auth.handler(request);

const profile = (
  name: string,
  email: string | null = `${name}@example.com`
): PlanningCenterProfile => ({
  sub: `person-${name}`,
  email,
  organizationId: `org-${name}`,
  organizationName: `${name} Church`,
});

const signInAs = async (
  person: PlanningCenterProfile
): Promise<NativeSignInRun> => {
  planningCenter.signInAs(person);
  return await runNativeSignIn(handler, origin);
};

const exchangeWith = async (
  run: NativeSignInRun,
  codeVerifier: string
): Promise<Response> =>
  await exchangeNativeCode(handler, origin, {
    code: run.redirect.searchParams.get("code"),
    codeVerifier,
  });

const errorCode = async (response: Response): Promise<string> => {
  const body = decodeErrorBody(await response.json());
  return body.code;
};

/** Signs in natively as `person` and returns the bearer token the app would keep. */
const tokenFor = async (person: PlanningCenterProfile): Promise<string> => {
  const run = await signInAs(person);
  const { token } = await parseExchange(
    await exchangeRun(handler, origin, run)
  );
  return token;
};

const sessionFor = async (token: string) =>
  await auth.api.getSession({
    headers: new Headers({ authorization: `Bearer ${token}` }),
  });

const userIdFor = async (email: string | null): Promise<string> => {
  const [row] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email ?? ""));
  return row?.id ?? "";
};

const accountIdFor = async (person: PlanningCenterProfile): Promise<string> => {
  const [row] = await database
    .select({ id: account.id })
    .from(account)
    .where(eq(account.accountId, person.sub));
  return row?.id ?? "";
};

const sessionCountFor = async (email: string | null): Promise<number> => {
  const rows = await database
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, await userIdFor(email)));
  return rows.length;
};

const handoffCount = async (): Promise<number> => {
  const rows = await database
    .select({ id: verification.id })
    .from(verification)
    .where(like(verification.identifier, "native-sign-in:%"));
  return rows.length;
};

const setCookieNames = (response: Response): string[] =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split("=")[0] ?? "")
    .toSorted();

/** The redirect URI without its query, for comparing against the allowlist. */
const redirectTarget = (url: URL): string =>
  `${url.protocol}//${url.host}${url.pathname}`;

const validStart = () => ({
  code_challenge: createPkcePair().challenge,
  code_challenge_method: "S256",
  state: createAppState(),
  redirect_uri: APP_REDIRECT_URI,
});

/** The web's sign-in start, in a browser holding `cookie`. */
const webSignInStart = async (cookie = ""): Promise<Response> =>
  await auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({
        provider: "planning-center",
        callbackURL: "/services",
        errorCallbackURL: "/auth",
        disableRedirect: true,
      }),
    })
  );

const authorizationUrlOf = async (response: Response): Promise<string> => {
  const { url } = decodeSignInResponse(await response.json());
  return url;
};

const selectedBy = async (person: PlanningCenterProfile) => {
  const run = await signInAs(person);
  const result = await parseExchange(await exchangeRun(handler, origin, run));
  return result.selectedAccountId;
};

describe("native sign-in", { timeout: LOCAL_WORKER_TEST_TIMEOUT_MS }, () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", planningCenter.fetch);
    auth = createAuth(config, database);
    await auth.$context;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await runtime.dispose();
  });

  it("starts Planning Center sign-in with its own PKCE and the web's callback", async () => {
    const parameters = validStart();
    const start = await startNativeSignIn(handler, origin, parameters);
    const authorize = new URL(start.headers.get("location") ?? "");

    expect(start.status).toBe(302);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://api.planningcenteronline.com/oauth/authorize"
    );
    expect({
      redirectUri: authorize.searchParams.get("redirect_uri"),
      prompt: authorize.searchParams.get("prompt"),
      method: authorize.searchParams.get("code_challenge_method"),
    }).toStrictEqual({
      redirectUri: `${origin}/api/auth/callback/planning-center`,
      prompt: "login",
      method: "S256",
    });
    // The server runs its own PKCE with Planning Center; the app's values stay on this origin.
    expect(authorize.searchParams.get("code_challenge")).not.toBe(
      parameters.code_challenge
    );
    expect(authorize.toString()).not.toContain(parameters.state);
  });

  it("sets the OAuth state cookie and a signed marker scoped to auth routes", async () => {
    const start = await startNativeSignIn(handler, origin, validStart());

    expect(setCookieNames(start)).toStrictEqual([MARKER_COOKIE, STATE_COOKIE]);
    expect(setCookieNamed(start, STATE_COOKIE)).toMatch(
      /; Max-Age=300; Path=\/; HttpOnly; SameSite=Lax$/u
    );
    expect(setCookieNamed(start, MARKER_COOKIE)).toMatch(
      /; Max-Age=600; Path=\/api\/auth; HttpOnly; SameSite=Lax$/u
    );
  });

  it("marks the marker Secure with the __Secure- prefix on https", async () => {
    const httpsAuth = createAuth(
      testServerConfig({ BETTER_AUTH_URL: "https://pcobooster.com" }),
      database
    );
    const start = await startNativeSignIn(
      async (request) => await httpsAuth.handler(request),
      "https://pcobooster.com",
      validStart()
    );
    expect(setCookieNamed(start, `__Secure-${MARKER_COOKIE}`)).toMatch(
      /; Max-Age=600; Path=\/api\/auth; HttpOnly; Secure; SameSite=Lax$/u
    );
  });

  it.each([
    ["missing", undefined],
    ["an unregistered scheme", "evilapp://auth/callback"],
    ["a web URL", "https://pcobooster.com/auth"],
    ["a longer path", "pcobooster://auth/callback/extra"],
    ["a query", "pcobooster://auth/callback?next=1"],
    ["a different case", "PCOBOOSTER://auth/callback"],
  ])(
    "refuses a redirect URI that is %s without redirecting",
    async (_case, redirectUri) => {
      const start = await startNativeSignIn(handler, origin, {
        ...validStart(),
        redirect_uri: redirectUri,
      });
      expect(start.status).toBe(400);
      expect(start.headers.get("location")).toBeNull();
      expect(start.headers.getSetCookie()).toStrictEqual([]);
      await expect(errorCode(start)).resolves.toBe("INVALID_REDIRECT_URI");
    }
  );

  it.each([
    ["a plain challenge method", { code_challenge_method: "plain" }],
    ["a short challenge", { code_challenge: "too-short" }],
    ["no challenge", { code_challenge: undefined }],
  ])("reports %s to the app as invalid_request", async (_case, override) => {
    const parameters = { ...validStart(), ...override };
    const start = await startNativeSignIn(handler, origin, parameters);
    const location = new URL(start.headers.get("location") ?? "");

    expect(start.status).toBe(302);
    expect(start.headers.getSetCookie()).toStrictEqual([]);
    expect(redirectTarget(location)).toBe(APP_REDIRECT_URI);
    expect(Object.fromEntries(location.searchParams)).toStrictEqual({
      error: "invalid_request",
      state: parameters.state,
    });
  });

  it("treats a repeated start parameter as missing", async () => {
    const parameters = validStart();
    const startWith = async (repeated: string): Promise<Response> =>
      await handler(
        new Request(
          `${origin}/api/auth/native/start?${new URLSearchParams(parameters).toString()}&${repeated}`
        )
      );
    const repeatedRedirect = await startWith(
      `redirect_uri=${encodeURIComponent("https://evil.example/callback")}`
    );
    const repeatedState = await startWith(`state=${createAppState()}`);
    const location = new URL(repeatedState.headers.get("location") ?? "");

    expect({
      status: repeatedRedirect.status,
      location: repeatedRedirect.headers.get("location"),
    }).toStrictEqual({ status: 400, location: null });
    await expect(errorCode(repeatedRedirect)).resolves.toBe(
      "INVALID_REDIRECT_URI"
    );
    expect({
      status: repeatedState.status,
      target: redirectTarget(location),
      parameters: Object.fromEntries(location.searchParams),
    }).toStrictEqual({
      status: 302,
      target: APP_REDIRECT_URI,
      parameters: { error: "invalid_request" },
    });
  });

  it("reports a guessable state without echoing it", async () => {
    const start = await startNativeSignIn(handler, origin, {
      ...validStart(),
      state: "short",
    });
    const location = new URL(start.headers.get("location") ?? "");
    expect(Object.fromEntries(location.searchParams)).toStrictEqual({
      error: "invalid_request",
    });
  });

  it("redirects a completed callback to the app with a code and its state", async () => {
    const run = await signInAs(profile("handoff"));

    expect(run.callback.status).toBe(302);
    expect(redirectTarget(run.redirect)).toBe(APP_REDIRECT_URI);
    expect([...run.redirect.searchParams.keys()]).toStrictEqual([
      "code",
      "state",
    ]);
    expect(run.redirect.searchParams.get("code")).toMatch(HANDOFF_CODE);
    expect(run.redirect.searchParams.get("state")).toBe(run.appState);
  });

  it("keeps the app's session out of the browser and spends the marker", async () => {
    const run = await signInAs(profile("browser-cookies"));

    expect(setCookieNames(run.callback)).toStrictEqual([
      MARKER_COOKIE,
      STATE_COOKIE,
    ]);
    // Expired on the path it was set on, or the browser would keep it.
    expect(setCookieNamed(run.callback, MARKER_COOKIE)).toMatch(
      /[=]; Max-Age=0; Path=\/api\/auth; HttpOnly; SameSite=Lax$/u
    );
    expect(setCookieNamed(run.callback, STATE_COOKIE)).toContain("Max-Age=0");
  });

  it("exchanges the code for a bearer token, the user, and the selected organization", async () => {
    const person = profile("exchange");
    const run = await signInAs(person);
    const response = await exchangeRun(handler, origin, run);

    expect({
      status: response.status,
      cookies: response.headers.getSetCookie(),
      cacheControl: response.headers.get("cache-control"),
    }).toStrictEqual({ status: 200, cookies: [], cacheControl: "no-store" });
    const result = await parseExchange(response);
    expect(result).toStrictEqual({
      token: result.token,
      user: {
        id: await userIdFor(person.email),
        name: "Jordan Example",
        email: person.email,
        image: null,
      },
      selectedAccountId: await accountIdFor(person),
    });
    expect(run.callback.headers.get("location")).not.toContain(
      result.token.split(".")[0]
    );
    const signedIn = await sessionFor(result.token);
    expect(signedIn?.user.id).toBe(result.user.id);
  });

  it("selects the organization each native sign-in used", async () => {
    const graceChurch = profile("select-a", "casey-native@example.com");
    const hopeChapel = profile("select-b", "casey-native@example.com");

    const first = await selectedBy(graceChurch);
    // Linking a second organization selects it, and signing in with the first selects it again.
    const linked = await selectedBy(hopeChapel);
    const returning = await selectedBy(graceChurch);

    expect([first, linked, returning]).toStrictEqual([
      await accountIdFor(graceChurch),
      await accountIdFor(hopeChapel),
      await accountIdFor(graceChurch),
    ]);
  });

  it.each(NATIVE_REDIRECT_URIS)(
    "returns to %s when the app asked for it",
    async (redirectUri) => {
      planningCenter.signInAs(profile(`scheme-${redirectUri.length}`));
      const run = await runNativeSignIn(handler, origin, { redirectUri });
      expect(redirectTarget(run.redirect)).toBe(redirectUri);
      expect(run.redirect.searchParams.get("code")).toMatch(HANDOFF_CODE);
    }
  );

  it("refuses to exchange a code twice", async () => {
    const run = await signInAs(profile("replay"));
    const first = await exchangeRun(handler, origin, run);
    const replay = await exchangeRun(handler, origin, run);

    expect([first.status, replay.status]).toStrictEqual([200, 400]);
    await expect(errorCode(replay)).resolves.toBe("INVALID_GRANT");
  });

  it("refuses the wrong verifier, burns the code, and discards its session", async () => {
    const person = profile("wrong-verifier");
    const run = await signInAs(person);
    const sessionsBefore = await sessionCountFor(person.email);

    const wrong = await exchangeWith(run, createPkcePair().verifier);
    const right = await exchangeRun(handler, origin, run);

    expect(sessionsBefore).toBe(1);
    expect([wrong.status, right.status]).toStrictEqual([400, 400]);
    await expect(errorCode(wrong)).resolves.toBe("INVALID_GRANT");
    await expect(sessionCountFor(person.email)).resolves.toBe(0);
  });

  it("refuses an expired code", async () => {
    const run = await signInAs(profile("expired"));
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    vi.setSystemTime(
      Date.now() + (NATIVE_HANDOFF_TTL_SECONDS + 1) * MILLISECONDS_PER_SECOND
    );

    const late = await exchangeRun(handler, origin, run);
    expect(late.status).toBe(400);
    await expect(errorCode(late)).resolves.toBe("INVALID_GRANT");
  });

  it("refuses a code whose session has already ended", async () => {
    const person = profile("ended-first");
    const run = await signInAs(person);
    await database
      .delete(session)
      .where(eq(session.userId, await userIdFor(person.email)));

    const response = await exchangeRun(handler, origin, run);
    expect(response.status).toBe(400);
    await expect(errorCode(response)).resolves.toBe("INVALID_GRANT");
  });

  it("refuses a code whose session has expired", async () => {
    const person = profile("expired-session");
    const run = await signInAs(person);
    await database
      .update(session)
      .set({ expiresAt: new Date(Date.now() - MILLISECONDS_PER_SECOND) })
      .where(eq(session.userId, await userIdFor(person.email)));

    const response = await exchangeRun(handler, origin, run);
    expect(response.status).toBe(400);
    await expect(errorCode(response)).resolves.toBe("INVALID_GRANT");
  });

  it("lets only one of several concurrent exchanges of a code succeed", async () => {
    const run = await signInAs(profile("concurrent"));
    const responses = await Promise.all(
      Array.from(
        { length: 4 },
        async () => await exchangeRun(handler, origin, run)
      )
    );
    const statuses = responses.map((response) => response.status);
    expect({
      succeeded: statuses.filter((status) => status === 200).length,
      refused: statuses.filter((status) => status === 400).length,
    }).toStrictEqual({ succeeded: 1, refused: 3 });
  });

  it.each<[string, ExchangeRequestBody]>([
    ["an empty body", {}],
    ["a short code", { code: "abc", codeVerifier: createPkcePair().verifier }],
    ["a short verifier", { code: "a".repeat(43), codeVerifier: "short" }],
  ])("rejects %s as INVALID_REQUEST", async (_case, body) => {
    const response = await exchangeNativeCode(handler, origin, body);
    expect(response.status).toBe(400);
    await expect(errorCode(response)).resolves.toBe("INVALID_REQUEST");
  });

  it("sends a failed callback back to the app with a stable error", async () => {
    const handoffsBefore = await handoffCount();
    const noEmail = await signInAs(profile("no-email", null));
    const declined = await runNativeSignIn(handler, origin, {
      providerParameters: { error: "access_denied" },
    });

    expect(Object.fromEntries(noEmail.redirect.searchParams)).toStrictEqual({
      error: "email_not_found",
      state: noEmail.appState,
    });
    expect(Object.fromEntries(declined.redirect.searchParams)).toStrictEqual({
      error: "access_denied",
      state: declined.appState,
    });
    expect(setCookieNamed(declined.callback, MARKER_COOKIE)).toContain(
      "Max-Age=0"
    );
    await expect(handoffCount()).resolves.toBe(handoffsBefore);
  });

  it("reports a browser flow that lost its state cookie as sign_in_expired", async () => {
    const parameters = validStart();
    const start = await startNativeSignIn(handler, origin, parameters);
    const markerOnly = cookieHeader(start)
      .split("; ")
      .filter((pair) => pair.startsWith(`${MARKER_COOKIE}=`))
      .join("; ");
    const callback = await callbackFor(
      handler,
      origin,
      start.headers.get("location") ?? "",
      markerOnly
    );
    const location = new URL(callback.headers.get("location") ?? "");

    expect(redirectTarget(location)).toBe(APP_REDIRECT_URI);
    expect(Object.fromEntries(location.searchParams)).toStrictEqual({
      error: "sign_in_expired",
      state: parameters.state,
    });
    expect(setCookieNames(callback)).toStrictEqual([MARKER_COOKIE]);
  });

  it("ignores a marker whose signature does not match its contents", async () => {
    const handoffsBefore = await handoffCount();
    planningCenter.signInAs(profile("tampered-marker"));
    const start = await startNativeSignIn(handler, origin, validStart());
    const jar = cookieHeader(start);
    const markerPair =
      jar.split("; ").find((pair) => pair.startsWith(`${MARKER_COOKIE}=`)) ??
      "";
    const signed = decodeURIComponent(
      markerPair.slice(MARKER_COOKIE.length + 1)
    );
    const separator = signed.lastIndexOf(".");
    // Swap in an attacker's challenge but keep the original signature.
    const forged = `${JSON.stringify({
      ...decodeMarkerFields(JSON.parse(signed.slice(0, separator))),
      challenge: createPkcePair().challenge,
    })}${signed.slice(separator)}`;
    const callback = await callbackFor(
      handler,
      origin,
      start.headers.get("location") ?? "",
      jar.replace(markerPair, `${MARKER_COOKIE}=${encodeURIComponent(forged)}`)
    );

    expect(callback.headers.get("location")).toBe("/services");
    await expect(handoffCount()).resolves.toBe(handoffsBefore);
  });

  it("still records a failed native callback like a web one", async () => {
    await runNativeSignIn(handler, origin, {
      providerParameters: { error: "server_error" },
    });
    const recorded = await database
      .select({ metadata: activityEvents.metadata })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.eventType, "auth_sign_in_failed"),
          eq(activityEvents.errorCode, "server_error")
        )
      );
    expect(recorded).toStrictEqual([{ metadata: { code: "unknown" } }]);
  });

  it("leaves the web sign-in's redirect and cookies unchanged", async () => {
    const handoffsBefore = await handoffCount();
    const person = profile("web");
    planningCenter.signInAs(person);
    const start = await webSignInStart();
    const callback = await callbackFor(
      handler,
      origin,
      await authorizationUrlOf(start),
      cookieHeader(start)
    );

    expect(callback.headers.get("location")).toBe("/services");
    expect(setCookieNames(callback)).toStrictEqual(
      [
        PLANNING_CENTER_SELECTED_ACCOUNT_COOKIE,
        SESSION_COOKIE,
        `${SESSION_COOKIE}_device-${await userIdFor(person.email)}`,
        SESSION_DATA_COOKIE,
        STATE_COOKIE,
      ].toSorted()
    );
    expect(setCookieNamed(callback, SESSION_COOKIE)).toMatch(
      /; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax$/u
    );
    await expect(handoffCount()).resolves.toBe(handoffsBefore);
  });

  it("never exposes a web session token to page scripts", async () => {
    const person = profile("web-token");
    planningCenter.signInAs(person);
    const start = await webSignInStart();
    const callback = await callbackFor(
      handler,
      origin,
      await authorizationUrlOf(start),
      cookieHeader(start)
    );
    const refreshed = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { cookie: cookieHeader(callback) },
      })
    );
    const refreshedSession = decodeSessionBody(await refreshed.json());

    expect(refreshedSession?.user.id).toBe(await userIdFor(person.email));
    expect(
      [callback, refreshed].map((response) =>
        response.headers.get("set-auth-token")
      )
    ).toStrictEqual([null, null]);
    expect(callback.headers.get("access-control-expose-headers")).toBeNull();
  });

  it("never exposes a refreshed web session token to page scripts", async () => {
    planningCenter.signInAs(profile("web-refresh"));
    const start = await webSignInStart();
    const callback = await callbackFor(
      handler,
      origin,
      await authorizationUrlOf(start),
      cookieHeader(start)
    );
    const sessionCookie = cookieHeader(callback)
      .split("; ")
      .filter((pair) => pair.startsWith(`${SESSION_COOKIE}=`))
      .join("; ");
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    // Past Better Auth's one-day update age, so reading the session re-issues its cookie.
    vi.setSystemTime(Date.now() + SESSION_REFRESH_AFTER_MS);
    const refreshed = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { cookie: sessionCookie },
      })
    );

    expect(setCookieNamed(refreshed, SESSION_COOKIE)).toMatch(
      /; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax$/u
    );
    expect({
      token: refreshed.headers.get("set-auth-token"),
      exposed: refreshed.headers.get("access-control-expose-headers"),
    }).toStrictEqual({ token: null, exposed: null });
  });

  it("ignores a native marker left in the browser by another flow", async () => {
    const abandoned = await startNativeSignIn(handler, origin, validStart());
    planningCenter.signInAs(profile("same-browser"));
    const web = await webSignInStart(cookieHeader(abandoned));
    // The web start replaced the state cookie; the native marker is still in the jar.
    const jar = cookieHeader(abandoned, web);
    const callback = await callbackFor(
      handler,
      origin,
      await authorizationUrlOf(web),
      jar
    );

    expect(jar).toContain(`${MARKER_COOKIE}=`);
    expect(callback.headers.get("location")).toBe("/services");
    expect(setCookieNamed(callback, SESSION_COOKIE)).toBeDefined();
  });

  it("accepts only signed bearer tokens", async () => {
    vi.useRealTimers();
    const token = await tokenFor(profile("signature"));
    const separator = token.lastIndexOf(".");
    const rawToken = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    // A different first character: a signature that already starts with "x" stays valid as "x…".
    const tamperedFirst = signature.startsWith("x") ? "y" : "x";
    const candidates = [
      token,
      rawToken,
      `${rawToken}.${tamperedFirst}${signature.slice(1)}`,
      `${rawToken}x.${signature}`,
    ];
    const sessions = [];
    for (const candidate of candidates) {
      // oxlint-disable-next-line no-await-in-loop -- sequential lookups avoid flaky parallel getSession races.
      sessions.push(await sessionFor(candidate));
    }

    expect(sessions.map((found) => found !== null)).toStrictEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("signs out a bearer session without cookies", async () => {
    const person = profile("sign-out");
    const token = await tokenFor(person);
    const authorization = `Bearer ${token}`;

    const signOut = await auth.handler(
      new Request(`${origin}/api/auth/sign-out`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: "{}",
      })
    );
    const afterSignOut = await auth.handler(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { authorization },
      })
    );

    expect(signOut.status).toBe(200);
    expect(decodeSessionBody(await afterSignOut.json())).toBeNull();
    await expect(sessionCountFor(person.email)).resolves.toBe(0);
  });
});
