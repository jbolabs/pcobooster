import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  convertV4MiniflareOptions,
  Response as MiniflareResponse,
} from "miniflare";
import type { Miniflare } from "miniflare";
import { build } from "rolldown";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createIsolatedMiniflare } from "../../../scripts/testing/miniflare";

const REQUEST_TIMEOUT_MS = 5000;
const WORKERD_TEST_TIMEOUT_MS = 30_000;

let script = "";
let worker: Miniflare | undefined;

/** Planning Center stand-in: `first` answers when the test releases it, others at once. */
const planningCenter = () => {
  const release = Promise.withResolvers<null>();
  const received: string[] = [];
  return {
    received,
    release: () => {
      release.resolve(null);
    },
    handler: async (request: Request) => {
      const name = new URL(request.url).pathname.slice(1);
      received.push(name);
      if (name === "first") {
        await release.promise;
      }
      return new MiniflareResponse(`answered ${name}`);
    },
  };
};

const settled = async (response: Promise<MiniflareResponse>) =>
  await Promise.race([
    response.then(async (result) => `${result.status} ${await result.text()}`),
    delay(REQUEST_TIMEOUT_MS, "timed out"),
  ]);

describe("send permits in workerd", () => {
  beforeAll(async () => {
    const { output } = await build({
      input: path.join(import.meta.dirname, "send-permits.fixture.ts"),
      platform: "browser",
      write: false,
      output: { format: "esm", codeSplitting: false },
    });
    script = output[0].code;
  }, WORKERD_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await worker?.dispose();
    worker = undefined;
  });

  it(
    "answers a request that waited for a permit another request held",
    async () => {
      const upstream = planningCenter();
      worker = await createIsolatedMiniflare(
        "send-permits",
        convertV4MiniflareOptions({
          modules: true,
          compatibilityDate: "2026-09-01",
          script,
          serviceBindings: { PLANNING_CENTER: upstream.handler },
        })
      );
      const first = worker.dispatchFetch("http://localhost/?name=first");
      await expect.poll(() => upstream.received).toStrictEqual(["first"]);
      const second = worker.dispatchFetch("http://localhost/?name=second");
      await delay(200);
      upstream.release();

      await expect(
        Promise.all([settled(first), settled(second)])
      ).resolves.toStrictEqual(["200 answered first", "200 answered second"]);
    },
    WORKERD_TEST_TIMEOUT_MS
  );
});
