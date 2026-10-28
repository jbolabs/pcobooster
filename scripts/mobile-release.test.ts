import { spawnSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import type { Json } from "effect/Schema";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  ascToken,
  buildState,
  makeAscClient,
  recentBuilds,
  takenBuildNumbers,
} from "../apps/mobile/scripts/release/asc";
import type { Fetch } from "../apps/mobile/scripts/release/asc";
import {
  automationMarker,
  chooseBuildNumber,
  exportOptionsPlist,
  parseBuildNumber,
  POSTHOG_PROJECT_KEY,
  processingOutcome,
  releaseAnalyticsKey,
  signingMode,
  stillUnused,
} from "../apps/mobile/scripts/release/release-rules";
import {
  acquireLock,
  assertLockHeld,
  claimedBuildNumbers,
  recordClaim,
  releaseLock,
} from "../apps/mobile/scripts/release/release-state";

const mobile = path.join(import.meta.dirname, "../apps/mobile");
const stateDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "pcob-release-state-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

describe("automation", () => {
  it.each(["true", "1", "TRUE", "yes", "anything"])(
    "treats CI=%j as automation",
    (value) => {
      expect(automationMarker({ CI: value })).toBe("CI");
    }
  );

  it.each(["", "0", "false", "False", "no", "off", " "])(
    "treats CI=%j as a local run",
    (value) => {
      expect(automationMarker({ CI: value })).toBeNull();
    }
  );

  it("recognizes other CI providers", () => {
    expect(automationMarker({ GITHUB_ACTIONS: "true" })).toBe("GITHUB_ACTIONS");
    expect(automationMarker({ JENKINS_URL: "https://ci.example" })).toBe(
      "JENKINS_URL"
    );
    expect(automationMarker({})).toBeNull();
  });
});

describe("signing", () => {
  it("signs with the key when one is supplied, and with Xcode's account locally otherwise", () => {
    expect(signingMode({ env: {}, hasKey: true })).toBe("api-key");
    expect(signingMode({ env: {}, hasKey: false })).toBe("xcode-account");
    expect(
      signingMode({
        env: { PCOB_RELEASE_SIGNING: "xcode-account" },
        hasKey: true,
      })
    ).toBe("xcode-account");
  });

  it.each([{ CI: "1" }, { CI: "true" }, { GITHUB_ACTIONS: "true" }])(
    "refuses the Apple account fallback in automation (%j)",
    (env) => {
      expect(() => signingMode({ env, hasKey: false })).toThrow("automation");
      expect(() =>
        signingMode({
          env: { ...env, PCOB_RELEASE_SIGNING: "xcode-account" },
          hasKey: true,
        })
      ).toThrow("automation");
      expect(signingMode({ env, hasKey: true })).toBe("api-key");
    }
  );

  it("refuses an unknown mode and a key mode without a key", () => {
    expect(() =>
      signingMode({ env: { PCOB_RELEASE_SIGNING: "manual" }, hasKey: true })
    ).toThrow("PCOB_RELEASE_SIGNING");
    expect(() =>
      signingMode({ env: { PCOB_RELEASE_SIGNING: "api-key" }, hasKey: false })
    ).toThrow("needs ASC_KEY_ID");
  });
});

const LOCAL_SIGNING = {
  PCOB_RELEASE_SIGNING: "api-key",
  PCOB_RELEASE_CERTIFICATE_SHA1: "0123456789abcdef0123456789abcdef01234567",
  PCOB_RELEASE_PROFILE_UUID: "a1234567-1234-4567-89ab-0123456789ab",
};

describe("local export options", () => {
  it("selects the exact installed distribution identity", () => {
    const plist = exportOptionsPlist({ env: LOCAL_SIGNING, hasKey: true });
    expect(plist).toContain("<key>signingStyle</key><string>manual</string>");
    expect(plist).toContain(
      "<key>signingCertificate</key><string>0123456789ABCDEF0123456789ABCDEF01234567</string>"
    );
    expect(plist).toContain(
      "<key>provisioningProfiles</key><dict>\n    <key>com.pcobooster.ios</key><string>a1234567-1234-4567-89ab-0123456789ab</string>\n  </dict>"
    );
  });

  it("exports for the fixed app team without changing the version or limiting beta availability", () => {
    const plist = exportOptionsPlist({ env: LOCAL_SIGNING, hasKey: true });
    expect(plist).toContain("<key>destination</key><string>export</string>");
    expect(plist).toContain("<key>teamID</key><string>6C46GY4Z38</string>");
    expect(plist).toContain(
      "<key>method</key><string>app-store-connect</string>"
    );
    expect(plist).toContain(
      "<key>manageAppVersionAndBuildNumber</key><false/>"
    );
    expect(plist).toContain("<key>testFlightInternalTestingOnly</key><false/>");
  });

  it("keeps automatic signing when local selectors are absent", () => {
    const plist = exportOptionsPlist({ env: {}, hasKey: true });
    expect(plist).toContain(
      "<key>signingStyle</key><string>automatic</string>"
    );
    expect(plist).not.toContain("<key>signingCertificate</key>");
    expect(plist).not.toContain("<key>provisioningProfiles</key>");
  });

  it.each([
    { PCOB_RELEASE_CERTIFICATE_SHA1: "" },
    { PCOB_RELEASE_PROFILE_UUID: "" },
    { PCOB_RELEASE_CERTIFICATE_SHA1: "Apple Distribution" },
    { PCOB_RELEASE_PROFILE_UUID: "</string><true/>" },
  ])(
    "refuses partial or malformed identities before signing (%j)",
    (override) => {
      expect(() =>
        signingMode({ env: { ...LOCAL_SIGNING, ...override }, hasKey: true })
      ).toThrow("Supply PCOB_RELEASE_CERTIFICATE_SHA1");
    }
  );

  it("refuses selectors with an Xcode account or without the API key", () => {
    expect(() =>
      exportOptionsPlist({
        env: { ...LOCAL_SIGNING, PCOB_RELEASE_SIGNING: "xcode-account" },
        hasKey: true,
      })
    ).toThrow("requires PCOB_RELEASE_SIGNING=api-key");
    expect(() =>
      exportOptionsPlist({ env: LOCAL_SIGNING, hasKey: false })
    ).toThrow("needs ASC_KEY_ID");
  });

  it.each([{ CI: "yes" }, { GITHUB_ACTIONS: "true" }, { BUILDKITE: "1" }])(
    "refuses explicit local identities in automation (%j)",
    (automation) => {
      expect(() =>
        exportOptionsPlist({
          env: { ...LOCAL_SIGNING, ...automation },
          hasKey: true,
        })
      ).toThrow("unavailable in automation");
    }
  );
});

describe("build numbers", () => {
  it("takes the next number after every App Store Connect build, upload, and local claim", () => {
    expect(
      chooseBuildNumber({ appStoreConnect: [371, 372], claimed: [] }, null)
    ).toBe(373);
    expect(
      chooseBuildNumber({ appStoreConnect: [372], claimed: [374] }, null)
    ).toBe(375);
    expect(chooseBuildNumber({ appStoreConnect: [], claimed: [] }, null)).toBe(
      293
    );
  });

  it("accepts a requested number only above everything taken", () => {
    expect(
      chooseBuildNumber({ appStoreConnect: [372], claimed: [] }, 380)
    ).toBe(380);
    expect(() =>
      chooseBuildNumber({ appStoreConnect: [372], claimed: [] }, 372)
    ).toThrow("App Store Connect already has");
    expect(() =>
      chooseBuildNumber({ appStoreConnect: [372], claimed: [375] }, 374)
    ).toThrow("a release on this machine claimed");
    expect(() =>
      chooseBuildNumber({ appStoreConnect: [], claimed: [] }, 292)
    ).toThrow("previous native app");
  });

  it("does not let squash-merge ancestry counts or lower numbers win without a key", () => {
    expect(() =>
      chooseBuildNumber({ appStoreConnect: null, claimed: [] }, null)
    ).toThrow("set BUILD_NUMBER");
    expect(
      chooseBuildNumber({ appStoreConnect: null, claimed: [373] }, 374)
    ).toBe(374);
    expect(() =>
      chooseBuildNumber({ appStoreConnect: null, claimed: [373] }, 373)
    ).toThrow("not above 373");
  });

  it("fails before upload once another release took the number or a higher one", () => {
    expect(() => {
      stillUnused(373, [371, 372]);
    }).not.toThrow();
    expect(() => {
      stillUnused(373, [373]);
    }).toThrow("Nothing was uploaded");
    expect(() => {
      stillUnused(373, [374]);
    }).toThrow("App Store Connect now has build 374");
  });

  it.each(["", "0", "01", "1.2", "-3", "373\n"])(
    "refuses build number %j",
    (value) => {
      expect(() => parseBuildNumber(value)).toThrow("BUILD_NUMBER");
    }
  );
});

describe("release analytics", () => {
  it("embeds pcobooster.com's public PostHog project key without reading any secret", () => {
    expect(POSTHOG_PROJECT_KEY).toMatch(/^phc_[A-Za-z\d]{44}$/u);
    expect(releaseAnalyticsKey({})).toBe(POSTHOG_PROJECT_KEY);
    expect(
      releaseAnalyticsKey({
        EXPO_PUBLIC_POSTHOG_KEY: POSTHOG_PROJECT_KEY,
        POSTHOG_PROJECT_KEY,
      })
    ).toBe(POSTHOG_PROJECT_KEY);
  });

  it.each(["EXPO_PUBLIC_POSTHOG_KEY", "POSTHOG_PROJECT_KEY"])(
    "refuses another project's key in %s",
    (name) => {
      expect(() => releaseAnalyticsKey({ [name]: "phc_other" })).toThrow(
        `${name} is not pcobooster.com's PostHog project key`
      );
    }
  );
});

describe("App Store Connect processing", () => {
  const state = {
    processingState: "VALID",
    version: "373",
    shortVersion: "0.1.0",
    expired: false,
  };

  it("counts only a VALID, unexpired build with this number and version as processed", () => {
    expect(processingOutcome(state, 373, "0.1.0")).toBe("processed");
    expect(processingOutcome({ ...state, version: "372" }, 373, "0.1.0")).toBe(
      "pending"
    );
    expect(
      processingOutcome({ ...state, shortVersion: "0.2.0" }, 373, "0.1.0")
    ).toBe("pending");
    expect(processingOutcome({ ...state, expired: true }, 373, "0.1.0")).toBe(
      "pending"
    );
  });

  it("waits for an unlisted or processing build and stops on a failed one", () => {
    expect(processingOutcome(null, 373, "0.1.0")).toBe("pending");
    expect(
      processingOutcome(
        { ...state, processingState: "PROCESSING" },
        373,
        "0.1.0"
      )
    ).toBe("pending");
    expect(
      processingOutcome({ ...state, processingState: "INVALID" }, 373, "0.1.0")
    ).toBe("failed");
    expect(
      processingOutcome({ ...state, processingState: "FAILED" }, 373, "0.1.0")
    ).toBe("failed");
  });
});

describe("the release lock and claims", () => {
  it("lets one release hold the lock and refuses a second while it runs", () => {
    const dir = stateDir();
    const owner = {
      pid: process.pid,
      revision: "abc",
      startedAt: "2026-10-06T00:00:00.000Z",
    };
    acquireLock(dir, owner);
    expect(() => {
      acquireLock(dir, { ...owner, revision: "def" });
    }).toThrow(
      `Another release holds ${dir}/lock: pid ${process.pid} (revision abc`
    );
    expect(() => {
      assertLockHeld(dir, process.pid);
    }).not.toThrow();
    releaseLock(dir, process.pid + 1);
    expect(() => {
      acquireLock(dir, owner);
    }).toThrow("Another release");
    releaseLock(dir, process.pid);
    expect(() => {
      acquireLock(dir, owner);
    }).not.toThrow();
  });

  it("keeps a dead release's lock until someone checks App Store Connect and removes it", () => {
    const dir = stateDir();
    const dead = spawnSync("true").pid ?? 1;
    acquireLock(dir, {
      pid: dead,
      revision: "abc",
      startedAt: "2026-10-06T00:00:00.000Z",
    });
    expect(() => {
      acquireLock(dir, { pid: process.pid, revision: "def", startedAt: "now" });
    }).toThrow("that process is gone. Check App Store Connect");
  });

  it("remembers every claimed build number", () => {
    const dir = stateDir();
    expect(claimedBuildNumbers(dir)).toStrictEqual([]);
    recordClaim(dir, 373, "abc", new Date("2026-10-06T00:00:00.000Z"));
    recordClaim(dir, 374, "def", new Date("2026-10-06T00:00:01.000Z"));
    expect(claimedBuildNumbers(dir)).toStrictEqual([373, 374]);
    expect(readFileSync(path.join(dir, "claims.jsonl"), "utf-8")).toContain(
      '"revision":"abc"'
    );
  });
});

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const key = {
  keyId: "KEY123",
  issuerId: "issuer-uuid",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
};
const API = "https://api.appstoreconnect.apple.com";

/** A fake App Store Connect answering `routes` by path (plus a `cursor` page suffix). */
const pages = (routes: Readonly<Record<string, Json>>) => {
  const requests: { url: string; method: string }[] = [];
  const fetch: Fetch = async (input, init) => {
    requests.push({ url: input, method: init?.method ?? "GET" });
    const url = new URL(input);
    const body =
      routes[`${url.pathname}${url.searchParams.get("cursor") ?? ""}`];
    return await Promise.resolve(
      body === undefined
        ? Response.json({ errors: [{ status: "404" }] }, { status: 404 })
        : Response.json(body)
    );
  };
  return { fetch, requests };
};

const uploadOf = (version: string, state: string) => ({
  id: `u${version}${state}`,
  type: "buildUploads",
  attributes: { cfBundleVersion: version, state: { state } },
});

describe("App Store Connect reads", () => {
  it("signs a 20-minute ES256 token App Store Connect accepts", () => {
    const token = ascToken(key, new Date("2026-10-06T00:00:00.000Z"));
    const [header, payload, signature] = token.split(".");
    expect(
      JSON.parse(Buffer.from(header ?? "", "base64url").toString())
    ).toStrictEqual({
      alg: "ES256",
      kid: "KEY123",
      typ: "JWT",
    });
    expect(
      JSON.parse(Buffer.from(payload ?? "", "base64url").toString())
    ).toStrictEqual({
      iss: "issuer-uuid",
      iat: 1_791_244_800,
      exp: 1_791_246_000,
      aud: "appstoreconnect-v1",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature ?? "", "base64url")
      )
    ).toBeTruthy();
  });

  it("collects build numbers from every page of builds and from in-flight uploads", async () => {
    const { fetch, requests } = pages({
      "/v1/builds": {
        data: [{ id: "b1", type: "builds", attributes: { version: "371" } }],
        links: { next: `${API}/v1/builds?cursor=2` },
      },
      "/v1/builds2": {
        data: [
          { id: "b2", type: "builds", attributes: { version: "372" } },
          { id: "b3", type: "builds", attributes: { version: "1.0.1" } },
        ],
      },
      "/v1/apps/app1/buildUploads": {
        data: [
          {
            id: "u1",
            type: "buildUploads",
            attributes: { cfBundleVersion: "373", state: "PROCESSING" },
          },
        ],
      },
    });
    const numbers = await takenBuildNumbers(makeAscClient(key, fetch), "app1");
    expect(numbers.toSorted((a, b) => a - b)).toStrictEqual([371, 372, 373]);
    expect(requests.every((request) => request.method === "GET")).toBeTruthy();
    expect(requests.map((request) => new URL(request.url).pathname)).toContain(
      "/v1/apps/app1/buildUploads"
    );
  });

  it("ignores only the AWAITING_UPLOAD record this release's own export created", async () => {
    const { fetch } = pages({
      "/v1/builds": {
        data: [{ id: "b1", type: "builds", attributes: { version: "373" } }],
      },
      "/v1/apps/app1/buildUploads": {
        data: [uploadOf("374", "AWAITING_UPLOAD"), uploadOf("373", "COMPLETE")],
      },
    });
    const client = makeAscClient(key, fetch);
    await expect(takenBuildNumbers(client, "app1")).resolves.toStrictEqual([
      373, 374, 373,
    ]);
    await expect(takenBuildNumbers(client, "app1", 374)).resolves.toStrictEqual(
      [373, 373]
    );
    // Another number's reservation still blocks.
    await expect(takenBuildNumbers(client, "app1", 375)).resolves.toContain(
      374
    );
  });

  it("still counts an own-number upload that is past AWAITING_UPLOAD", async () => {
    const { fetch } = pages({
      "/v1/builds": { data: [] },
      "/v1/apps/app1/buildUploads": {
        data: [
          {
            id: "u1",
            type: "buildUploads",
            attributes: {
              cfBundleVersion: "374",
              state: { state: "PROCESSING" },
            },
          },
        ],
      },
    });
    await expect(
      takenBuildNumbers(makeAscClient(key, fetch), "app1", 374)
    ).resolves.toStrictEqual([374]);
  });

  it("fails instead of treating a refused read as no builds", async () => {
    const { fetch } = pages({ "/v1/builds": { data: [] } });
    await expect(
      takenBuildNumbers(makeAscClient(key, fetch), "app1")
    ).rejects.toThrow("answered 404 for /v1/apps/app1/buildUploads");
  });

  it("refuses to follow a page link off the App Store Connect API", async () => {
    const { fetch } = pages({
      "/v1/builds": {
        data: [],
        links: { next: "https://elsewhere.example/v1/builds" },
      },
      "/v1/apps/app1/buildUploads": { data: [] },
    });
    await expect(
      takenBuildNumbers(makeAscClient(key, fetch), "app1")
    ).rejects.toThrow("paged outside its API");
  });

  it("reports a build's processing state, TestFlight states, and beta groups", async () => {
    const { fetch } = pages({
      "/v1/builds": {
        data: [
          {
            id: "b2",
            type: "builds",
            attributes: {
              version: "372",
              processingState: "VALID",
              uploadedDate: "2026-10-06T00:00:00Z",
              expired: false,
            },
            relationships: {
              preReleaseVersion: {
                data: { id: "p1", type: "preReleaseVersions" },
              },
              buildBetaDetail: { data: { id: "d1", type: "buildBetaDetails" } },
              betaGroups: { data: [{ id: "g1", type: "betaGroups" }] },
            },
          },
        ],
        included: [
          {
            id: "p1",
            type: "preReleaseVersions",
            attributes: { version: "0.1.0" },
          },
          {
            id: "d1",
            type: "buildBetaDetails",
            attributes: {
              internalBuildState: "IN_BETA_TESTING",
              externalBuildState: null,
            },
          },
          { id: "g1", type: "betaGroups", attributes: { name: "Me" } },
        ],
      },
    });
    await expect(
      buildState(makeAscClient(key, fetch), "app1", 372)
    ).resolves.toStrictEqual({
      buildId: "b2",
      version: "372",
      shortVersion: "0.1.0",
      processingState: "VALID",
      uploadedDate: "2026-10-06T00:00:00Z",
      expired: false,
      internalBuildState: "IN_BETA_TESTING",
      externalBuildState: null,
      betaGroups: ["Me"],
    });
  });
});

describe("listing TestFlight builds", () => {
  it("reads one page of the newest builds and reports uploads above them", async () => {
    const { fetch, requests } = pages({
      "/v1/builds": {
        data: [
          {
            id: "b373",
            type: "builds",
            attributes: { version: "373", processingState: "VALID" },
          },
          {
            id: "b372",
            type: "builds",
            attributes: { version: "372", processingState: "VALID" },
          },
        ],
        // A second page must not be read.
        links: { next: `${API}/v1/builds?cursor=2` },
      },
      "/v1/apps/app1/buildUploads": {
        data: [
          {
            id: "u1",
            type: "buildUploads",
            attributes: { cfBundleVersion: "373", state: "COMPLETE" },
          },
          {
            id: "u2",
            type: "buildUploads",
            attributes: { cfBundleVersion: "374", state: "PROCESSING" },
          },
        ],
      },
    });
    const recent = await recentBuilds(makeAscClient(key, fetch), "app1", 2);
    expect(recent.builds.map((build) => build.version)).toStrictEqual([
      "373",
      "372",
    ]);
    expect(recent.pendingUploads).toStrictEqual([
      { version: "374", state: "PROCESSING" },
    ]);
    const buildsRequest = new URL(
      requests.find((request) => request.url.includes("/v1/builds?"))?.url ?? ""
    );
    expect(buildsRequest.searchParams.get("sort")).toBe("-uploadedDate");
    expect(
      requests.filter((request) => request.url.includes("cursor="))
    ).toStrictEqual([]);
  });
});

const cli = (args: string[], env: Record<string, string>) =>
  spawnSync("bun", ["run", "scripts/release/release-cli.ts", ...args], {
    cwd: mobile,
    encoding: "utf-8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...env,
    },
  });

const claimEnv = () => {
  const dir = stateDir();
  return { dir, env: { PCOB_RELEASE_STATE_DIR: dir } };
};

const choose = (env: Record<string, string>, requested: string | null) =>
  cli(
    [
      "build-number",
      "choose",
      "--pid",
      String(process.pid),
      "--revision",
      "abc",
      ...(requested === null ? [] : ["--requested", requested]),
    ],
    env
  );

const lock = (env: Record<string, string>) =>
  cli(
    ["lock", "acquire", "--pid", String(process.pid), "--revision", "abc"],
    env
  );

// Real CLI launches and throwaway checkouts need headroom on shared CI runners.
describe("release-cli", { timeout: 30_000 }, () => {
  it("refuses the local Apple account in automation, whatever the truthy CI form", () => {
    for (const ci of ["true", "1", "yes"]) {
      const result = cli(["signing"], { CI: ci });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("CI marks this run as automation");
    }
    expect(cli(["signing"], { CI: "0" }).stdout.trim()).toBe("xcode-account");
    expect(cli(["signing", "--has-key"], { CI: "1" }).stdout.trim()).toBe(
      "api-key"
    );
  }, 15_000);

  it("prints validated manual export options and refuses malformed selectors", () => {
    const valid = cli(["export-options", "--has-key"], LOCAL_SIGNING);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain(
      "<key>signingCertificate</key><string>0123456789ABCDEF0123456789ABCDEF01234567</string>"
    );
    const invalid = cli(["export-options", "--has-key"], {
      ...LOCAL_SIGNING,
      PCOB_RELEASE_PROFILE_UUID: "wrong",
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Supply PCOB_RELEASE_CERTIFICATE_SHA1");
  });

  it("prints the committed analytics key and refuses another", () => {
    expect(cli(["analytics-key"], {}).stdout.trim()).toBe(POSTHOG_PROJECT_KEY);
    const other = cli(["analytics-key"], { POSTHOG_PROJECT_KEY: "phc_other" });
    expect(other.status).toBe(1);
    expect(other.stderr).toContain("not pcobooster.com's PostHog project key");
  });

  it("needs a key to list builds, and a bounded limit", () => {
    expect(cli(["latest"], {}).stderr).toContain("needs an API key");
    expect(cli(["builds", "--limit", "0"], {}).stderr).toContain(
      "--limit must be a whole number from 1 to 200"
    );
  });

  it("refuses upload-number validation without an App Store Connect read key", () => {
    const result = cli(["build-number", "verify", "--build", "372"], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "cannot be validated without an App Store Connect read key"
    );
  });

  it("claims build numbers only while holding the release lock", () => {
    const { dir, env } = claimEnv();
    expect(choose(env, "400").stderr).toContain(
      "only while holding the release lock"
    );
    expect(lock(env).status).toBe(0);
    expect(lock(env).stderr).toContain("Another release holds");
    expect(claimedBuildNumbers(dir)).toStrictEqual([]);
  });

  it("claims a requested build number once, and needs one without a key", () => {
    const { dir, env } = claimEnv();
    lock(env);
    const first = choose(env, "400");
    expect(first.stdout.trim()).toBe("400");
    expect(first.stderr).toContain("App Store Connect was not checked");
    expect(choose(env, "400").stderr).toContain(
      "BUILD_NUMBER 400 is not above 400"
    );
    expect(choose(env, null).stderr).toContain("set BUILD_NUMBER");
    expect(claimedBuildNumbers(dir)).toStrictEqual([400]);
  });
});
