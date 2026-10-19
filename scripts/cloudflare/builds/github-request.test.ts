import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";

import { createIsolatedMiniflare } from "../../testing/miniflare";
import { repositoryReadResult } from "./github-request";

describe("Worker repository proxy", () => {
  it("constructs its authenticated non-following request in real workerd", async () => {
    const source = execFileSync(
      "bun",
      [
        "build",
        fileURLToPath(new URL("github-request.ts", import.meta.url)),
        "--target=browser",
      ],
      { encoding: "utf-8" }
    );
    const runtime = await createIsolatedMiniflare("github-request", {
      workers: [
        {
          config: {
            name: "github-request",
            compatibilityDate: "2026-09-01",
            manifest: {
              mainModule: "index.js",
              modules: {
                "request.js": { type: "esm", contents: source },
                "index.js": {
                  type: "esm",
                  contents: `import { githubReadRequest } from "./request.js";
export default { fetch() { const r = githubReadRequest("https://api.github.com/repos/jbolabs/pcobooster/pulls/408", "test-token"); return Response.json({redirect:r.redirect,authorization:r.headers.get("Authorization"),method:r.method}); } };`,
                },
              },
            },
          },
        },
      ],
    });
    onTestFinished(async () => {
      await runtime.dispose();
    });
    const response = await runtime.dispatchFetch("https://test/");
    await expect(response.json()).resolves.toStrictEqual({
      redirect: "manual",
      authorization: "Bearer test-token",
      method: "GET",
    });
  });

  it("rejects redirects instead of forwarding a token or a Location header", async () => {
    const result = repositoryReadResult(
      Response.redirect("https://example.com", 302)
    );
    expect(result.status).toBe(502);
    await expect(result.text()).resolves.toBe("Repository redirect refused");
  });
});
