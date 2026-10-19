import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { describe, expect, it, onTestFinished } from "vitest";

import { createIsolatedMiniflare } from "../../testing/miniflare";

const setup = async () => {
  const runtime = await createIsolatedMiniflare("trial-cache", {
    workers: [
      {
        config: {
          name: "trial-cache",
          compatibilityDate: "2026-09-01",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: stripTypeScriptTypes(
                  readFileSync(
                    new URL("cache-worker.ts", import.meta.url),
                    "utf-8"
                  )
                ),
              },
            },
          },
          env: {
            TOKEN: { type: "text", value: "test-secret" },
            CACHE: { type: "r2", name: "trial-cache" },
          },
        },
      },
    ],
  });
  onTestFinished(async () => {
    await runtime.dispose();
  });
  return runtime;
};

describe("isolated Turbo cache", () => {
  it("round-trips an artifact through R2", async () => {
    const runtime = await setup();
    const url = "https://cache.example/v8/artifacts/0123456789abcdef";
    const headers = { Authorization: "Bearer test-secret" };
    const miss = await runtime.dispatchFetch(url, { headers });
    expect(miss.status).toBe(404);
    const put = await runtime.dispatchFetch(url, {
      method: "PUT",
      headers,
      body: "cached validation",
    });
    expect(put.status).toBe(204);
    const hit = await runtime.dispatchFetch(url, { headers });
    await expect(hit.text()).resolves.toBe("cached validation");
  });

  it("rejects unauthorized access and invalid artifact paths", async () => {
    const runtime = await setup();
    const url = "https://cache.example/v8/artifacts/0123456789abcdef";
    const missing = await runtime.dispatchFetch(url);
    const wrong = await runtime.dispatchFetch(url, {
      headers: { Authorization: "Bearer wrong" },
    });
    const invalid = await runtime.dispatchFetch(
      "https://cache.example/v8/artifacts/not-a-hash",
      { headers: { Authorization: "Bearer test-secret" } }
    );
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(invalid.status).toBe(404);
  });
});
