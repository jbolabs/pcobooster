import { createHash, randomBytes } from "node:crypto";

import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeFixtureFetch } from "../harness/fixture-transport";
import { noLaunchOptions } from "../harness/launch-options";
import {
  memorySecretStorage,
  INSTALL_MARKER_KEY,
} from "../session/credential-store";

const REQUEST_ID =
  /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/u;

vi.stubGlobal("__DEV__", true);
const { makeFixtureRuntime, makeLiveRuntime, makeReleaseSmokeRuntime } =
  await import("./app-runtime");

const testCrypto = {
  randomBytes: (count: number) => new Uint8Array(randomBytes(count)),
  sha256: async (text: string) =>
    await Promise.resolve(
      new Uint8Array(createHash("sha256").update(text).digest())
    ),
};

/** One simulated install: its Keychain and its app storage survive relaunches. */
const smokeDevice = () => {
  const plain = new Map<string, string>();
  return {
    secrets: memorySecretStorage(),
    appStorage: {
      getItem: async (key: string) =>
        await Promise.resolve(plain.get(key) ?? null),
      setItem: async (key: string, value: string) => {
        plain.set(key, value);
        await Promise.resolve();
      },
    },
    crypto: testCrypto,
    authenticate: async () => await Promise.resolve(null),
    onForget: undefined,
    appRelease: null,
  };
};
const smokeNow = () => new Date("2026-10-01T17:00:00.000Z");

describe("release smoke runtime", () => {
  beforeEach(() => {
    // Smoke builds are Release builds.
    vi.stubGlobal("__DEV__", false);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a fresh install signed out without touching the network", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requests.push(new Request(input).url);
      return await Promise.reject(new Error("production network"));
    });
    const runtime = makeReleaseSmokeRuntime(
      noLaunchOptions,
      smokeDevice(),
      "offline",
      smokeNow
    );
    await runtime.start();
    expect(runtime.origin).toBe("https://fixtures.invalid");
    expect(runtime.session.getSnapshot().phase.kind).toBe("signedOut");
    expect(requests).toStrictEqual([]);
  });

  it("restores a fixture sign-in from the device's Keychain on the next launch, offline too", async () => {
    const device = smokeDevice();
    const first = makeReleaseSmokeRuntime(
      noLaunchOptions,
      device,
      "online",
      smokeNow
    );
    await first.start();
    await first.session.completeSignIn(await first.signIn());
    expect(first.session.getSnapshot().phase.kind).toBe("signedIn");
    expect(device.secrets.items.size).toBe(1);

    const relaunched = makeReleaseSmokeRuntime(
      noLaunchOptions,
      device,
      "offline",
      smokeNow
    );
    await relaunched.start();
    expect(relaunched.session.getSnapshot().phase.kind).toBe("signedIn");
    expect(relaunched.isFixtureMode).toBeFalsy();
  });
});

describe("demo.start's request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends no credential headers when starting a demo from a signed-in account", async () => {
    const requests: Request[] = [];
    const fixtureFetch = makeFixtureFetch({ latencyMs: 0 });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init));
        return await fixtureFetch(input, init);
      }
    );
    vi.stubGlobal("__DEV__", true);
    const runtime = makeLiveRuntime(noLaunchOptions, {
      secrets: memorySecretStorage(),
      appStorage: {
        getItem: async (key) =>
          await Promise.resolve(key === INSTALL_MARKER_KEY ? "true" : null),
        setItem: async () => {
          await Promise.resolve();
        },
      },
      crypto: {
        randomBytes: (count) => new Uint8Array(randomBytes(count)),
        sha256: async (text) =>
          await Promise.resolve(
            new Uint8Array(createHash("sha256").update(text).digest())
          ),
      },
      authenticate: async () => await Promise.resolve(null),
      onForget: undefined,
      appRelease: "0.1.0(372)+1a2b3c4",
    });
    await runtime.start();
    await runtime.session.completeSignIn({
      token: "session.signature",
      user: { id: "u1", name: "Jordan", email: "j@example.test" },
      selectedAccountId: "acct1",
    });
    await runtime.session.startDemo("fixture-demo-key");
    expect(runtime.session.getSnapshot().phase.kind).toBe("demo");
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.credentials).toBe("omit");
    expect(
      [
        "authorization",
        "x-pcobooster-account",
        "x-pcobooster-demo",
        "cookie",
      ].map((name) => request?.headers.get(name))
    ).toStrictEqual([null, null, null, null]);
    // The release and a fresh request ID go with every call, credentials or not.
    expect([
      request?.headers.get("x-pcobooster-client"),
      request?.headers.get("x-pcobooster-app"),
      REQUEST_ID.test(request?.headers.get("x-request-id") ?? ""),
    ]).toStrictEqual(["expo;api=2", "0.1.0(372)+1a2b3c4", true]);
  });
});

describe("fixture feature overrides", () => {
  beforeEach(() => {
    vi.stubGlobal("__DEV__", true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["all", { people: true, chordCharts: true, practice: true }],
    ["none", { people: false, chordCharts: false, practice: false }],
    ["people", { people: true, chordCharts: false, practice: false }],
    ["songs", { people: false, chordCharts: true, practice: false }],
  ] as const)(
    "decodes the complete %s feature response",
    async (features, expected) => {
      const runtime = makeFixtureRuntime(
        { ...noLaunchOptions, mock: true, features, mockLatencyMs: 0 },
        smokeNow
      );
      await runtime.start();
      await expect(
        runtime.client.run((api) => api.features.status())
      ).resolves.toStrictEqual(expected);
    }
  );
});

describe("account deletion credentials across a queued account switch", () => {
  it("attributes A's rejected deletion to A while keeping B signed in", async () => {
    vi.stubGlobal("__DEV__", true);
    const seen: string[] = [];
    const runtime = makeLiveRuntime(noLaunchOptions, {
      ...smokeDevice(),
      productFetch: async (input, init) => {
        const request = new Request(input, init);
        seen.push(request.headers.get("authorization") ?? "");
        return await Promise.resolve(
          Response.json(
            { _tag: "Unauthenticated", message: "Expired A" },
            { status: 401 }
          )
        );
      },
    });
    await runtime.session.restore();
    await runtime.session.completeSignIn({
      token: "token-B",
      user: { id: "B", name: "B", email: "b@example.test" },
      selectedAccountId: null,
    });
    await runtime.session.completeSignIn({
      token: "token-A",
      user: { id: "A", name: "A", email: "a@example.test" },
      selectedAccountId: null,
    });
    const gate = Promise.withResolvers<null>();
    const { track } = runtime.scheduler;
    runtime.scheduler.track = async (priority, call, signal) => {
      await gate.promise;
      return await track(priority, call, signal);
    };
    const deletion = runtime.session.deleteAccount();
    runtime.session.switchAccount("B");
    gate.resolve(null);
    await expect(deletion).rejects.toBeInstanceOf(Unauthenticated);
    const snapshot = runtime.session.getSnapshot();
    expect({
      phase: snapshot.phase.kind,
      active: snapshot.stored.activeUserId,
      rejected: snapshot.stored.accounts
        .filter((account) => account.needsSignIn)
        .map((account) => account.userId),
      seen,
    }).toStrictEqual({
      phase: "signedIn",
      active: "B",
      rejected: [],
      seen: ["Bearer token-A"],
    });
  });
});
