import { Schema } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";

import { createIsolatedMiniflare } from "../../testing/miniflare";
import {
  DispatchRejectedError,
  reconcileBuild,
  serializedBuild,
} from "./serialized";

const setup = async () => {
  const runtime = await createIsolatedMiniflare("build-lane", {
    workers: [
      {
        config: {
          name: "build-lane",
          compatibilityDate: "2026-09-01",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents:
                  'export default { fetch() { return new Response("ok") } }',
              },
            },
          },
          env: { RECORDS: { type: "r2", name: "build-lane" } },
        },
      },
    ],
  });
  onTestFinished(async () => {
    await runtime.dispose();
  });
  return await runtime.getR2Bucket("RECORDS");
};
const identity = { trigger: "maintenance", branch: "main" };
const active = async () =>
  await Promise.resolve(
    Response.json({ success: true, result: { status: "running" } })
  );
const stopped = async () =>
  await Promise.resolve(
    Response.json({ success: true, result: { status: "stopped" } })
  );
const candidate = async (branch: string) =>
  await Promise.resolve(
    Response.json({
      success: true,
      result: {
        build_uuid: "lost-build",
        created_on: new Date().toISOString(),
        trigger: { trigger_uuid: "maintenance" },
        build_trigger_metadata: { branch },
      },
    })
  );

describe("stateful Builds serialization", () => {
  it("retries a definite rejection but excludes overlapping stateful builds", async () => {
    const bucket = await setup();
    await expect(
      serializedBuild(
        bucket,
        active,
        async () => await Promise.reject(new DispatchRejectedError("400")),
        identity
      )
    ).rejects.toThrow("400");
    await expect(
      serializedBuild(
        bucket,
        active,
        async () => await Promise.resolve("build-one"),
        identity
      )
    ).resolves.toBeTruthy();
    await expect(
      serializedBuild(
        bucket,
        active,
        async () => await Promise.resolve("build-two"),
        identity
      )
    ).resolves.toBeFalsy();
    const record = await bucket.get("stateful-build");
    await expect(record?.json()).resolves.toMatchObject({
      build: "build-one",
      trigger: "maintenance",
    });
  });

  it("keeps an uncertain dispatch locked until a matching provider build is adopted", async () => {
    const bucket = await setup();
    await expect(
      serializedBuild(
        bucket,
        active,
        async () => await Promise.reject(new Error("response lost")),
        identity
      )
    ).rejects.toThrow("response lost");
    await expect(
      serializedBuild(
        bucket,
        active,
        async () => await Promise.resolve("duplicate"),
        identity
      )
    ).rejects.toThrow("requires reconciliation");
    const record = await bucket.get("stateful-build");
    const lane = Schema.decodeUnknownSync(
      Schema.Struct({ attempt: Schema.String })
    )(await record?.json());
    await expect(
      reconcileBuild(
        bucket,
        lane.attempt,
        "lost-build",
        async () => await candidate("wrong")
      )
    ).rejects.toThrow("does not match");
    await expect(
      reconcileBuild(
        bucket,
        lane.attempt,
        "lost-build",
        async () => await candidate("main")
      )
    ).resolves.toBeTruthy();
    await expect(
      serializedBuild(
        bucket,
        stopped,
        async () => await Promise.resolve("next-build"),
        identity
      )
    ).resolves.toBeTruthy();
  });
});
