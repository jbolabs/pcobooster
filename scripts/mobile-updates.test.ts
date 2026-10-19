import { generateKeyPairSync } from "node:crypto";

import { testServer } from "@pcobooster/api/testing/server";
import { decodePublishedUpdate } from "@pcobooster/contracts/mobile-updates";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { POSTHOG_PROJECT_KEY } from "../apps/mobile/scripts/release/release-rules";
import {
  checkLiveUpdate,
  readLiveAnswer,
} from "../apps/mobile/scripts/updates/live-check";
import type { LiveAnswer } from "../apps/mobile/scripts/updates/live-check";
import { decodePreparedRelease } from "../apps/mobile/scripts/updates/prepared-release";
import type { PreparedRelease } from "../apps/mobile/scripts/updates/prepared-release";
import {
  runUpdatePublish,
  withoutCredentials,
} from "../apps/mobile/scripts/updates/publish";
import type {
  PublishDependencies,
  PublishOptions,
  UpdateCheckout,
} from "../apps/mobile/scripts/updates/publish";
import {
  buildManifest,
  publishedRollBack,
  publishedUpdate,
} from "../apps/mobile/scripts/updates/update-manifest";
import {
  signerFromEnvironment,
  signerFromPem,
  verifierFromPublicKey,
} from "../apps/mobile/scripts/updates/update-signing";
import { serveHttpForTest } from "../apps/server/src/test-http";

const SHA = "1".repeat(40);
const RUNTIME = "26d8f75d228029e1bf0e5b295511ca1b76c3f825";

/** A throwaway update key; the real one never leaves the operator's Keychain. */
const keyPair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    sign: signerFromPem(privateKey.export({ type: "pkcs8", format: "pem" })),
    verify: verifierFromPublicKey(publicKey),
  };
};
const KEY = keyPair();

/** The message a run fails with, or "succeeded". */
const failureOf = async (run: Promise<unknown>): Promise<string> => {
  try {
    await run;
    return "succeeded";
  } catch (error) {
    return error instanceof Error ? error.message : "failed";
  }
};

/** Whether a publish reached the deploy step. */
const deployed = (steps: readonly string[]) =>
  steps.some((step) => step.startsWith("bun alchemy deploy"));

/** Known digests: "abc" and the empty file. */
const ABC = {
  sha256: "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",
  md5: "900150983cd24fb0d6963f7d28e17f72",
};
const EMPTY = {
  sha256: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
  md5: "d41d8cd98f00b204e9800998ecf8427e",
};
const UUID_V4 =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

const manifestFor = (
  bundle: string,
  createdAt = new Date("2026-10-08T20:00:00Z")
) =>
  buildManifest({
    runtimeVersion: RUNTIME,
    createdAt,
    origin: "https://pcobooster.com",
    revision: SHA,
    expoClient: { name: "PCOBooster" },
    launch: {
      path: "export/_expo/static/js/ios/index.hbc",
      bytes: new TextEncoder().encode(bundle),
    },
    assets: [
      { path: "export/assets/d41d8cd9", bytes: new Uint8Array(), ext: "png" },
    ],
  });

describe("update manifests", () => {
  it("lists every file by its SHA-256 for phones and the bucket, and its MD5 as Expo's asset key", () => {
    const { manifest, uploads } = manifestFor("abc");

    expect({ ...manifest, id: "" }).toStrictEqual({
      id: "",
      createdAt: "2026-10-08T20:00:00.000Z",
      runtimeVersion: RUNTIME,
      launchAsset: {
        hash: ABC.sha256,
        key: ABC.md5,
        contentType: "application/javascript",
        url: `https://pcobooster.com/api/updates/assets/${ABC.sha256}`,
      },
      assets: [
        {
          hash: EMPTY.sha256,
          key: EMPTY.md5,
          contentType: "image/png",
          fileExtension: ".png",
          url: `https://pcobooster.com/api/updates/assets/${EMPTY.sha256}`,
        },
      ],
      metadata: {},
      extra: { expoClient: { name: "PCOBooster" }, revision: SHA },
    });
    expect(uploads).toStrictEqual([
      {
        hash: ABC.sha256,
        path: "export/_expo/static/js/ios/index.hbc",
        contentType: "application/javascript",
      },
      {
        hash: EMPTY.sha256,
        path: "export/assets/d41d8cd9",
        contentType: "image/png",
      },
    ]);
  });

  it("names every publish a new update, even of unchanged JavaScript, and the same inputs the same id", () => {
    const first = manifestFor("abc").manifest.id;
    const sameInputs = manifestFor("abc").manifest.id;
    const republished = manifestFor("abc", new Date("2026-10-09T08:00:00Z"))
      .manifest.id;
    const changed = manifestFor("abd").manifest.id;

    expect(first).toMatch(UUID_V4);
    expect({
      sameInputs: sameInputs === first,
      republishedDiffers: republished !== first,
      changedDiffers: changed !== first,
    }).toStrictEqual({
      sameInputs: true,
      republishedDiffers: true,
      changedDiffers: true,
    });
  });

  it("signs the exact bodies phones receive, so the certificate's key verifies them and no other does", () => {
    const update = publishedUpdate(manifestFor("abc").manifest, KEY.sign);
    const rollBack = publishedRollBack(
      new Date("2026-10-08T21:00:00Z"),
      KEY.sign
    );
    const other = keyPair();

    expect({
      manifest:
        update._tag === "Update" &&
        KEY.verify(update.manifest.body, update.manifest.signature),
      byAnotherKey:
        update._tag === "Update" &&
        other.verify(update.manifest.body, update.manifest.signature),
      tampered:
        update._tag === "Update" &&
        KEY.verify(`${update.manifest.body} `, update.manifest.signature),
      rollBack:
        rollBack._tag === "RollBackToEmbedded" ? rollBack.directive.body : "",
      noUpdate: rollBack.noUpdateAvailable.body,
    }).toStrictEqual({
      manifest: true,
      byAnotherKey: false,
      tampered: false,
      rollBack:
        '{"type":"rollBackToEmbedded","parameters":{"commitTime":"2026-10-08T21:00:00.000Z"}}',
      noUpdate: '{"type":"noUpdateAvailable"}',
    });
  });

  it("refuses a signing key the builds' certificate does not accept", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });

    expect(() =>
      signerFromEnvironment({
        UPDATES_SIGNING_KEY_PEM_BASE64: Buffer.from(pem).toString("base64"),
      })
    ).toThrow("does not match certs/updates-certificate.pem");
  });
});

/** The API Worker's router serving one published update and its files from memory. */
const serving = (bundle: string) => {
  const { manifest, uploads } = manifestFor(bundle);
  const published = publishedUpdate(manifest, KEY.sign);
  const files = new Map(
    uploads.map((upload, index) => [upload.hash, index === 0 ? bundle : ""])
  );
  const app = serveHttpForTest({
    server: testServer(),
    updates: {
      readText: (key) =>
        Effect.succeed(
          key === `ios/${RUNTIME}/current.json` && published._tag === "Update"
            ? JSON.stringify(published)
            : null
        ),
      readAsset: (key) => {
        const body = files.get(key.replace("assets/", ""));
        return Effect.succeed(
          body === undefined
            ? null
            : {
                bytes: new TextEncoder().encode(body),
                contentType: "application/octet-stream",
              }
        );
      },
    },
  });
  const fetchThroughRouter: typeof fetch = async (input, init) =>
    await app.fetch(new Request(input, init));
  return { published, fetchThroughRouter };
};

describe(checkLiveUpdate, () => {
  it("accepts what the API Worker serves for a published update, signatures and asset hashes included", async () => {
    const { published, fetchThroughRouter } = serving("abc");
    if (published._tag !== "Update") {
      throw new Error("expected an update");
    }

    await expect(
      checkLiveUpdate({
        origin: "https://pcobooster.com",
        runtimeVersion: RUNTIME,
        expected: {
          kind: "update",
          updateId: published.updateId,
          manifest: published.manifest.body,
          noUpdateAvailable: published.noUpdateAvailable.body,
        },
        verify: KEY.verify,
        fetch: fetchThroughRouter,
      })
    ).resolves.toStrictEqual({
      answers: ["manifest", "noUpdateAvailable to phones running it"],
      assets: 2,
    });
  });

  it("reads what a runtime version's phones are told: nothing, or the published update and its revision", async () => {
    const { published, fetchThroughRouter } = serving("abc");
    const ask = async (runtimeVersion: string) =>
      await readLiveAnswer({
        origin: "https://pcobooster.com",
        runtimeVersion,
        verify: KEY.verify,
        fetch: fetchThroughRouter,
      });

    await expect(
      Promise.all([ask(RUNTIME), ask("0".repeat(40))])
    ).resolves.toStrictEqual([
      {
        kind: "update",
        updateId: published._tag === "Update" ? published.updateId : "",
        createdAt: "2026-10-08T20:00:00.000Z",
        revision: SHA,
        signatureVerifies: true,
      },
      { kind: "nothing" },
    ]);
  });

  it("rejects an answer signed by another key, and a manifest other than the one just published", async () => {
    const { published, fetchThroughRouter } = serving("abc");
    if (published._tag !== "Update") {
      throw new Error("expected an update");
    }
    const expected = {
      kind: "update" as const,
      updateId: published.updateId,
      manifest: published.manifest.body,
      noUpdateAvailable: published.noUpdateAvailable.body,
    };
    const check = async (
      overrides: Partial<Parameters<typeof checkLiveUpdate>[0]>
    ) =>
      await failureOf(
        checkLiveUpdate({
          origin: "https://pcobooster.com",
          runtimeVersion: RUNTIME,
          expected,
          verify: KEY.verify,
          fetch: fetchThroughRouter,
          ...overrides,
        })
      );

    expect({
      otherKey: await check({ verify: keyPair().verify }),
      stale: await check({
        expected: { ...expected, manifest: manifestFor("abd").manifest.id },
      }),
    }).toStrictEqual({
      otherKey:
        "The manifest part is not signed by the key the builds' certificate accepts.",
      stale: "The route does not serve the published manifest yet.",
    });
  });
});

const ON_MAIN: UpdateCheckout = { head: SHA, originMain: SHA, dirty: false };
const HERMES = Buffer.from("c61fbc03c103191f", "hex");
const BUNDLE = Buffer.concat([
  HERMES,
  Buffer.from(`bytecode ${POSTHOG_PROJECT_KEY} ${SHA}`),
]);

const ENV = {
  PATH: "/usr/bin",
  UPDATES_SIGNING_KEY_PEM_BASE64: "c2lnbmluZy1rZXk=",
  CLOUDFLARE_API_TOKEN: "inherited",
};

interface Fake {
  readonly checkouts?: readonly UpdateCheckout[];
  readonly served?: string;
  readonly live?: LiveAnswer;
  readonly bundle?: Buffer;
  readonly confirmed?: boolean;
}

/** A publish whose every external step is recorded instead of run. */
const harness = (fake: Fake = {}) => {
  const steps: string[] = [];
  const envs: Record<string, Readonly<Record<string, string | undefined>>> = {};
  const checkouts = [...(fake.checkouts ?? [ON_MAIN, ON_MAIN])];
  const saved: PreparedRelease[] = [];
  const summaries: string[] = [];
  const live: string[] = [];
  const record = (
    command: string,
    args: readonly string[],
    env: Readonly<Record<string, string | undefined>>
  ) => {
    const name = [command, ...args].join(" ");
    steps.push(name);
    envs[name] = env;
  };
  const deps: PublishDependencies = {
    checkout: () => {
      steps.push("checkout");
      return checkouts.shift() ?? ON_MAIN;
    },
    run: record,
    output: (command, args, env) => {
      record(command, args, env);
      return args.includes("runtimeversion:resolve")
        ? JSON.stringify({ runtimeVersion: RUNTIME, fingerprintSources: [] })
        : JSON.stringify({ name: "PCOBooster" });
    },
    productionApiRevision: async () =>
      await Promise.resolve(fake.served ?? SHA),
    liveAnswer: async () =>
      await Promise.resolve(
        fake.live ?? {
          kind: "update",
          updateId: "4d0f201d-da64-477e-a4b3-4af11d32c91e",
          createdAt: "2026-10-08T19:00:00.000Z",
          revision: "2".repeat(40),
          signatureVerifies: true,
        }
      ),
    readExport: () => ({
      metadata: JSON.stringify({
        version: 0,
        bundler: "metro",
        fileMetadata: {
          ios: {
            bundle: "_expo/static/js/ios/index.hbc",
            assets: [{ path: "assets/d41d8cd9", ext: "png" }],
          },
        },
      }),
      files: (relative) =>
        relative.endsWith(".hbc") ? (fake.bundle ?? BUNDLE) : new Uint8Array(),
    }),
    saveRelease: (release) => {
      steps.push("save release");
      saved.push(release);
      return "/tmp/release-prod.json";
    },
    confirm: async (summary, code) => {
      steps.push(`confirm ${code}`);
      summaries.push(summary);
      return await Promise.resolve(fake.confirmed ?? true);
    },
    checkLive: async (origin, runtimeVersion, expected) => {
      steps.push("check live");
      live.push(`${origin} ${runtimeVersion} ${expected.kind}`);
      return await Promise.resolve({ answers: [expected.kind], assets: 0 });
    },
    now: () => new Date("2026-10-08T20:00:00Z"),
    log: () => {},
  };
  return { deps, steps, envs, saved, live, summaries };
};

const OPTIONS: PublishOptions = {
  env: ENV,
  stage: "prod",
  rollback: false,
  localOrigin: "http://127.0.0.1:4101",
  sign: KEY.sign,
  verify: KEY.verify,
};

describe(runUpdatePublish, () => {
  it("preflights, exports, gates, signs, confirms, publishes files then the answer, and checks it live", async () => {
    const { deps, steps, saved, live } = harness();

    const result = await runUpdatePublish(deps, OPTIONS);
    const [release] = saved;
    const stored =
      release === undefined ? undefined : decodePublishedUpdate(release.record);
    const updateId =
      stored !== undefined &&
      Result.isSuccess(stored) &&
      stored.success._tag === "Update"
        ? stored.success.updateId
        : "";

    expect({
      result,
      steps,
      live,
      uploads: release?.uploads.map((upload) => upload.path),
    }).toStrictEqual({
      result: {
        stage: "prod",
        runtimeVersion: RUNTIME,
        revision: SHA,
        summary: `update ${updateId}`,
      },
      steps: [
        "checkout",
        "bun install --frozen-lockfile",
        "bun run ci",
        "bun run --cwd apps/mobile ios:release-smoke --build",
        "checkout",
        "bunx expo-updates runtimeversion:resolve --platform ios",
        `rm -rf build/updates/${SHA}`,
        `bunx expo export --platform ios --output-dir build/updates/${SHA}/export --dump-sourcemap --clear`,
        `bun run scripts/hermes-gate/gate.ts --bundle build/updates/${SHA}/export/_expo/static/js/ios/index.hbc`,
        "bunx expo config --type public --json",
        "save release",
        `confirm ${updateId.slice(0, 8)}`,
        "bun alchemy deploy alchemy.mobile-updates.ts --stage prod --yes",
        "check live",
      ],
      live: [`https://pcobooster.com ${RUNTIME} update`],
      uploads: [
        `build/updates/${SHA}/export/_expo/static/js/ios/index.hbc`,
        `build/updates/${SHA}/export/assets/d41d8cd9`,
      ],
    });
  });

  it("keeps the signing key and Cloudflare token from every step, and exports with only the committed analytics key and this revision", async () => {
    const { deps, envs } = harness();

    await runUpdatePublish(deps, {
      ...OPTIONS,
      env: { ...ENV, EXPO_PUBLIC_EXPERIMENT: "on" },
    });
    const leaked = Object.entries(envs).filter(
      ([, env]) =>
        "UPDATES_SIGNING_KEY_PEM_BASE64" in env || "CLOUDFLARE_API_TOKEN" in env
    );
    const exportEnv =
      envs[
        `bunx expo export --platform ios --output-dir build/updates/${SHA}/export --dump-sourcemap --clear`
      ];
    const deployEnv =
      envs["bun alchemy deploy alchemy.mobile-updates.ts --stage prod --yes"];

    expect({
      leaked,
      exportEnv: [
        exportEnv?.EXPO_PUBLIC_POSTHOG_KEY,
        exportEnv?.EXPO_PUBLIC_SOURCE_REVISION,
        exportEnv?.NODE_ENV,
        exportEnv?.EXPO_NO_DOTENV,
      ],
      publicValues: Object.keys(exportEnv ?? {})
        .filter((name) => name.startsWith("EXPO_PUBLIC_"))
        .toSorted(),
      deployEnv: [
        deployEnv?.PCOB_MOBILE_UPDATE_RELEASE,
        deployEnv?.CLOUDFLARE_ACCOUNT_ID,
      ],
    }).toStrictEqual({
      leaked: [],
      exportEnv: [POSTHOG_PROJECT_KEY, SHA, "production", "1"],
      publicValues: ["EXPO_PUBLIC_POSTHOG_KEY", "EXPO_PUBLIC_SOURCE_REVISION"],
      deployEnv: ["/tmp/release-prod.json", "984b82870acd18daf8bda97bad966b38"],
    });
    expect(withoutCredentials(ENV)).toStrictEqual({ PATH: "/usr/bin" });
  });

  it("refuses before running anything when the checkout is not origin/main or production serves another commit", async () => {
    const dirty = harness({ checkouts: [{ ...ON_MAIN, dirty: true }] });
    const behind = harness({
      checkouts: [{ ...ON_MAIN, originMain: "2".repeat(40) }],
    });
    const undeployed = harness({ served: "3".repeat(40) });

    expect({
      dirty: await failureOf(runUpdatePublish(dirty.deps, OPTIONS)),
      behind: await failureOf(runUpdatePublish(behind.deps, OPTIONS)),
      undeployed: await failureOf(runUpdatePublish(undeployed.deps, OPTIONS)),
      ran: [...dirty.steps, ...behind.steps, ...undeployed.steps],
    }).toStrictEqual({
      dirty:
        "The checkout has changes before publishing. Publish only committed source.",
      behind: `HEAD ${SHA} is not origin/main ${"2".repeat(40)}. Publish only what main deployed.`,
      undeployed: `Production's API serves ${"3".repeat(40)}, not ${SHA}. Wait for main's deploy to finish so the update never runs ahead of its API.`,
      ran: ["checkout", "checkout", "checkout"],
    });
  });

  it("publishes nothing when the export is not Hermes bytecode, lacks the analytics key or revision, or is not confirmed", async () => {
    const notHermes = harness({
      bundle: Buffer.from(`plain ${POSTHOG_PROJECT_KEY}`),
    });
    const noAnalytics = harness({
      bundle: Buffer.concat([HERMES, Buffer.from("bytecode")]),
    });
    const noRevision = harness({
      bundle: Buffer.concat([HERMES, Buffer.from(POSTHOG_PROJECT_KEY)]),
    });
    const declined = harness({ confirmed: false });
    expect({
      notHermes: await failureOf(runUpdatePublish(notHermes.deps, OPTIONS)),
      noAnalytics: await failureOf(runUpdatePublish(noAnalytics.deps, OPTIONS)),
      noRevision: await failureOf(runUpdatePublish(noRevision.deps, OPTIONS)),
      declined: await failureOf(runUpdatePublish(declined.deps, OPTIONS)),
      deployed: [
        notHermes.steps,
        noAnalytics.steps,
        noRevision.steps,
        declined.steps,
      ].map(deployed),
    }).toStrictEqual({
      notHermes: "_expo/static/js/ios/index.hbc is not Hermes bytecode.",
      noAnalytics:
        "The exported JavaScript does not embed the PostHog project key; analytics and diagnostics would be off. Nothing was published.",
      noRevision: `The exported JavaScript does not carry revision ${SHA}; diagnostics would misname it. Nothing was published.`,
      declined: "Not confirmed. Nothing was published.",
      deployed: [false, false, false, false],
    });
  });

  it("rolls a runtime version back without a preflight or export, even from a checkout with changes", async () => {
    const { deps, steps, saved, live } = harness({
      checkouts: [{ ...ON_MAIN, dirty: true }],
    });

    const result = await runUpdatePublish(deps, {
      ...OPTIONS,
      rollback: true,
      runtimeVersion: RUNTIME,
    });
    const [release] = saved;

    expect({
      result,
      steps,
      live,
      record:
        release === undefined
          ? undefined
          : decodePreparedRelease(JSON.stringify(release)).uploads,
    }).toStrictEqual({
      result: {
        stage: "prod",
        runtimeVersion: RUNTIME,
        revision: SHA,
        summary: "roll back to the JavaScript each build shipped with",
      },
      steps: [
        "checkout",
        "save release",
        `confirm ${RUNTIME.slice(0, 8)}`,
        "bun alchemy deploy alchemy.mobile-updates.ts --stage prod --yes",
        "check live",
      ],
      live: [`https://pcobooster.com ${RUNTIME} rollBackToEmbedded`],
      record: [],
    });
  });

  it("warns before the first update for a runtime version that it reaches only matching builds", async () => {
    const first = harness({ live: { kind: "nothing" } });
    const next = harness();

    await runUpdatePublish(first.deps, OPTIONS);
    await runUpdatePublish(next.deps, OPTIONS);

    expect(
      [first.summaries[0], next.summaries[0]].map((summary) =>
        summary?.endsWith(
          "Nothing is published for this runtime version yet: it reaches only builds whose `build/release/runtime-version` matches."
        )
      )
    ).toStrictEqual([true, false]);
  });

  it("refuses to roll back a runtime version that has no update published", async () => {
    const nothing = harness({ live: { kind: "nothing" } });
    const rolledBack = harness({
      live: {
        kind: "directive",
        type: "rollBackToEmbedded",
        commitTime: "2026-10-08T21:00:00.000Z",
        signatureVerifies: true,
      },
    });
    const rollback = { ...OPTIONS, rollback: true, runtimeVersion: RUNTIME };
    const refusal = `prod has no update for runtime version ${RUNTIME} to roll back. Pass the --runtime-version of the builds running it; \`bun run ios:update:status --runtime-version <fingerprint>\` shows what each is told.`;

    expect({
      nothing: await failureOf(runUpdatePublish(nothing.deps, rollback)),
      rolledBack: await failureOf(runUpdatePublish(rolledBack.deps, rollback)),
      deployed: [nothing.steps, rolledBack.steps].map(deployed),
    }).toStrictEqual({
      nothing: refusal,
      rolledBack: refusal,
      deployed: [false, false],
    });
  });

  it("refuses the variables release archives refuse, before running anything", async () => {
    const refusals = await Promise.all(
      [
        { EXPO_PUBLIC_PCOB_RELEASE_SMOKE: "1" },
        { EXPO_PUBLIC_DIAGNOSTICS_PROBES: "1" },
        { PCOB_UPDATES_URL: "http://127.0.0.1:4271/api/updates/manifest" },
      ].map(async (extra) => {
        const { deps, steps } = harness();
        const message = await failureOf(
          runUpdatePublish(deps, { ...OPTIONS, env: { ...ENV, ...extra } })
        );
        return `${message} (${steps.length} steps)`;
      })
    );

    expect(refusals).toStrictEqual([
      "EXPO_PUBLIC_PCOB_RELEASE_SMOKE builds the fixture smoke app; unset it to publish. (0 steps)",
      "EXPO_PUBLIC_DIAGNOSTICS_PROBES belongs to a separate internal verification build; unset it to publish. (0 steps)",
      "PCOB_UPDATES_URL points builds at a local update server and changes the runtime version; unset it to publish. (0 steps)",
    ]);
  });

  it("rehearses against the local stack from any checkout, pointing the build's runtime version at it", async () => {
    const { deps, steps, envs, live } = harness({
      checkouts: [{ ...ON_MAIN, dirty: true, originMain: "2".repeat(40) }],
    });

    await runUpdatePublish(deps, { ...OPTIONS, stage: "local" });

    expect({
      preflighted: steps.includes("bun run ci"),
      updatesUrl:
        envs["bunx expo-updates runtimeversion:resolve --platform ios"]
          ?.PCOB_UPDATES_URL,
      live,
    }).toStrictEqual({
      preflighted: false,
      updatesUrl: "http://127.0.0.1:4101/api/updates/manifest",
      live: [`http://127.0.0.1:4101 ${RUNTIME} update`],
    });
  });
});
