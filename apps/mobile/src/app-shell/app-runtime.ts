import { makeProductClient } from "@pcobooster/client/product-client";
import {
  createRequestScheduler,
  SPECULATIVE_QUIET_MS,
} from "@pcobooster/client/request-scheduler";
import type { RequestScheduler } from "@pcobooster/client/request-scheduler";
/**
 * The app session's runtime, built once at launch: the session store, the one product client
 * (with a header getter reading the session's credentials), the request scheduler, and native
 * sign-in. Fixture mode (`-PCOBMock YES`, development builds) swaps the network and the Keychain
 * for the fixture transport and memory, and keeps everything else.
 */
import type { enabledFeaturesSchema } from "@pcobooster/contracts/http/features";
import { APP_RELEASE_HEADER } from "@pcobooster/contracts/http/request-diagnostics";
import { Effect, Schema } from "effect";

import type { ReportOrigin } from "../diagnostics/diagnostics-client";
import { makeFixtureFetch } from "../harness/fixture-transport";
import type { FeatureOverride, LaunchOptions } from "../harness/launch-options";
import { offlineFetch } from "../harness/release-smoke";
import type { SmokeNetwork } from "../harness/release-smoke";
import {
  clearIfFreshInstall,
  makeCredentialStore,
  memorySecretStorage,
} from "../session/credential-store";
import type { PlainStorage, SecretStorage } from "../session/credential-store";
import { demoTokenFromSetCookie } from "../session/demo-cookie";
import type { StoredSession } from "../session/device-session";
import {
  DEVELOPMENT_REDIRECT_URI,
  makeNativeSignIn,
  RELEASE_REDIRECT_URI,
} from "../session/native-sign-in";
import type {
  NativeSignIn,
  NativeSignInResult,
  WebAuthentication,
} from "../session/native-sign-in";
import { pkceChallenge } from "../session/pkce";
import type { SignInCrypto } from "../session/pkce";
import { credentialHeaders, SessionStore } from "../session/session-store";
import type { SessionStoreDependencies } from "../session/session-store";
import {
  DemoLinkFailureError,
  liveCallIdentity,
  makeAppClient,
} from "./app-client";
import type { AppClient, AppClients } from "./app-client";
import { mockSignInResult, mockStoredSession } from "./device-accounts";

const TRAILING_SLASHES = /\/+$/u;
const LOCAL_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u;

/**
 * The API origin. Release builds always use pcobooster.com. Development builds use
 * `EXPO_PUBLIC_API_URL` (the product URL `bun run dev` prints), else the main checkout's local
 * product origin, as the Swift app's Debug default.
 */
export const API_ORIGIN: string = __DEV__
  ? Schema.decodeUnknownSync(Schema.String)(
      process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3001"
    ).replace(TRAILING_SLASHES, "")
  : "https://pcobooster.com";

/** A local API, where `bun run dev` signs every request in with its personal access token. */
export const isLocalOrigin = (origin: string): boolean =>
  LOCAL_ORIGIN.test(origin);

const featureOverrides = {
  all: { people: true, chordCharts: true, practice: true },
  none: { people: false, chordCharts: false, practice: false },
  people: { people: true, chordCharts: false, practice: false },
  songs: { people: false, chordCharts: true, practice: false },
} satisfies Record<FeatureOverride, typeof enabledFeaturesSchema.Type>;

export interface AppRuntime {
  readonly origin: string;
  readonly isFixtureMode: boolean;
  /** Development builds against a local API: check for the personal access token sign-in. */
  readonly checksDevelopmentSignIn: boolean;
  readonly session: SessionStore;
  readonly client: AppClient;
  /** The client for one account scope's query cache; it never sends for another scope. */
  readonly clientForScope: (scope: string) => AppClient;
  readonly scheduler: RequestScheduler;
  readonly signIn: () => Promise<NativeSignInResult>;
  /** Starts the session: clears a reinstall's Keychain, then reads it. */
  readonly start: () => Promise<void>;
}

interface RuntimeParts {
  readonly origin: string;
  readonly fetch: typeof globalThis.fetch;
  readonly secrets: SecretStorage;
  readonly signIn: NativeSignIn | null;
  readonly now: () => Date;
  readonly credentialIdentity: (token: string) => Promise<string>;
  readonly seed: StoredSession | null;
  readonly onForget?: SessionStoreDependencies["onForget"];
  readonly beforeRestore?: () => Promise<void>;
  /** The installed release sent as `x-pcobooster-app`; null sends none. */
  readonly appRelease: string | null;
  /** The diagnostics context each call starts in (`Diagnostics.origin`). */
  readonly reportOrigin?: () => ReportOrigin;
}

const MOCK_SIGN_IN_DELAY_MS = 500;

const buildRuntime = (
  options: LaunchOptions,
  parts: RuntimeParts
): AppRuntime => {
  const { fetch, secrets, signIn, now, origin } = parts;
  const scheduler = createRequestScheduler({ quietMs: SPECULATIVE_QUIET_MS });
  // The session and the client refer to each other: the client's header getter reads the
  // session, and the session's own calls go through the client.
  let client: AppClients | null = null;
  const run: AppClient["run"] = async (call, runOptions) => {
    if (client === null) {
      throw new Error("The product client is not ready");
    }
    return await client.run(call, runOptions);
  };

  let receivedDemoToken: string | null = null;
  const session = new SessionStore({
    store: makeCredentialStore(secrets),
    now,
    credentialIdentity: parts.credentialIdentity,
    revoke: async (token) => {
      await signIn?.revoke(token);
    },
    onForget: parts.onForget,
    beforeRestore: parts.beforeRestore,
    api: {
      selectAccount: async (accountId) => {
        const input = { accountId };
        const result = await run((api) =>
          api.accounts.select({ payload: input })
        );
        return result.selectedAccountId;
      },
      exitDemo: async () => {
        await run((api) => api.demo.exit());
      },
      deleteAccount: async (bearerToken) => {
        if (client === null) {
          throw new Error("The product client is not ready");
        }
        await client
          .forCredentials({
            bearerToken,
            accountId: null,
            demoToken: null,
          })
          .run((api) => api.user.delete());
      },
      isSignedInWithoutCredentials: async () => {
        const result = await run((api) => api.session.status());
        return result.authenticated;
      },
      startDemo: async (key) => {
        receivedDemoToken = null;
        const input = { key };
        const answer = await run((api) => api.demo.start({ payload: input }), {
          httpHeaders: {
            authorization: "",
            "x-pcobooster-account": "",
            "x-pcobooster-demo": "",
          },
        });
        const token = receivedDemoToken;
        if (!answer.demo || token === null) {
          throw new DemoLinkFailureError();
        }
        return token;
      },
    },
  });

  const product = makeProductClient({
    url: origin,
    client: "expo",
    // Never cookies: the session is the bearer token, the account and demo headers.
    credentials: "omit",
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      for (const name of [
        "authorization",
        "x-pcobooster-account",
        "x-pcobooster-demo",
      ]) {
        if (headers.get(name) === "") {
          headers.delete(name);
        }
      }
      const response = await fetch(input, { ...init, headers });
      const token = demoTokenFromSetCookie(response.headers.get("set-cookie"));
      if (token !== null) {
        receivedDemoToken = token;
      }
      return response;
    },
    httpHeaders: () => {
      const headers = new Headers(credentialHeaders(session.credentials()));
      if (parts.appRelease !== null) {
        headers.set(APP_RELEASE_HEADER, parts.appRelease);
      }
      return headers;
    },
  });
  client = makeAppClient(
    product,
    {
      credentials: session.credentials,
      handleUnauthorized: session.handleUnauthorized,
      scope: () => session.getSnapshot().scope,
    },
    scheduler,
    { ...liveCallIdentity, origin: parts.reportOrigin }
  );
  if (parts.seed !== null) {
    // The fixture session is known up front, so the first frame is already signed in.
    session.seed(parts.seed);
  }

  return {
    origin,
    isFixtureMode: options.mock,
    checksDevelopmentSignIn: __DEV__ && !options.mock && isLocalOrigin(origin),
    session,
    client,
    clientForScope: client.forScope,
    scheduler,
    signIn: async () => {
      if (signIn === null) {
        // The fixture harness signs in as Jordan Hale after a moment, as the Swift mock did.
        await Effect.runPromise(Effect.sleep(MOCK_SIGN_IN_DELAY_MS));
        return mockSignInResult();
      }
      return await signIn.signIn();
    },
    start: async () => {
      if (parts.seed !== null) {
        return;
      }
      await session.restore();
    },
  };
};

/** The fixture harness runtime: fixtures, memory, the fixed clock, a seeded mock session. */
export const makeFixtureRuntime = (
  options: LaunchOptions,
  now: () => Date
): AppRuntime =>
  buildRuntime(options, {
    origin: "https://fixtures.invalid",
    fetch: makeFixtureFetch({
      latencyMs: options.mockLatencyMs,
      overrides:
        options.features === null
          ? {}
          : { "features.status": featureOverrides[options.features] },
    }),
    secrets: memorySecretStorage(),
    signIn: null,
    now,
    credentialIdentity: async () => await Promise.resolve("fixture"),
    seed: mockStoredSession(options.mockSession, now()),
    appRelease: null,
  });

export interface DeviceServices {
  readonly secrets: SecretStorage;
  readonly appStorage: PlainStorage;
  readonly crypto: SignInCrypto;
  readonly authenticate: WebAuthentication;
  readonly onForget: SessionStoreDependencies["onForget"];
  /** The product client's fetch; a verification build's API probe wraps it. */
  readonly productFetch?: typeof globalThis.fetch;
  /** The installed release (`0.1.0(372)+1a2b3c4`) the API logs with each request. */
  readonly appRelease: string | null;
  /** The diagnostics context each call starts in. */
  readonly reportOrigin?: () => ReportOrigin;
}

/** The real runtime: the network, the Keychain, and native sign-in. */
export const makeLiveRuntime = (
  options: LaunchOptions,
  device: DeviceServices
): AppRuntime =>
  buildRuntime(options, {
    origin: API_ORIGIN,
    fetch: device.productFetch ?? globalThis.fetch,
    secrets: device.secrets,
    signIn: makeNativeSignIn({
      origin: API_ORIGIN,
      // Development builds sign in through `pcobooster-dev`, release builds `pcobooster`.
      redirectUri: __DEV__ ? DEVELOPMENT_REDIRECT_URI : RELEASE_REDIRECT_URI,
      crypto: device.crypto,
      authenticate: device.authenticate,
      fetch: globalThis.fetch,
    }),
    now: () => new Date(),
    credentialIdentity: async (token) =>
      await pkceChallenge(device.crypto, token),
    seed: null,
    onForget: device.onForget,
    beforeRestore: async () => {
      await clearIfFreshInstall(device.secrets, device.appStorage);
    },
    appRelease: device.appRelease,
    reportOrigin: device.reportOrigin,
  });

/**
 * A release smoke build's runtime (`harness/release-smoke.ts`): the device's Keychain, app
 * storage, and fresh-install check, as the real runtime has, with the fixtures (or a lost
 * connection) for the network and the fixture sign-in for the browser.
 */
export const makeReleaseSmokeRuntime = (
  options: LaunchOptions,
  device: DeviceServices,
  network: SmokeNetwork,
  now: () => Date
): AppRuntime =>
  buildRuntime(options, {
    origin: "https://fixtures.invalid",
    fetch:
      network === "online"
        ? makeFixtureFetch({ latencyMs: options.mockLatencyMs })
        : offlineFetch,
    secrets: device.secrets,
    signIn: null,
    now,
    credentialIdentity: async (token) =>
      await pkceChallenge(device.crypto, token),
    seed: null,
    appRelease: device.appRelease,
    reportOrigin: device.reportOrigin,
    onForget: device.onForget,
    beforeRestore: async () => {
      await clearIfFreshInstall(device.secrets, device.appStorage);
    },
  });
