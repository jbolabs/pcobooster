import { generateKeyPairSync, verify } from "node:crypto";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { allowedGitHubPath, installationToken } from "./github-app";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const credentials = {
  GITHUB_APP_ID: "5385188",
  GITHUB_INSTALLATION_ID: "173133738",
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
};

describe("repository authentication", () => {
  it("signs a short-lived JWT and requests only read access to pcobooster", async () => {
    const token = await installationToken(
      credentials,
      async (input, init) => {
        expect(input).toBe(
          "https://api.github.com/app/installations/173133738/access_tokens"
        );
        expect(init?.method).toBe("POST");
        expect(
          JSON.parse(Schema.decodeUnknownSync(Schema.String)(init?.body))
        ).toStrictEqual({
          repository_ids: [1_125_110_564],
          permissions: { contents: "read", pull_requests: "read" },
        });
        const jwt = new Headers(init?.headers).get("Authorization")?.slice(7);
        if (jwt === undefined || jwt === "") {
          throw new Error("Missing JWT");
        }
        const [header, payload, signature] = jwt.split(".");
        if (!payload || !signature) {
          throw new Error("Invalid JWT");
        }
        expect(
          JSON.parse(Buffer.from(payload, "base64url").toString())
        ).toStrictEqual({
          iss: "5385188",
          iat: 1_792_425_540,
          exp: 1_792_426_140,
        });
        expect(
          verify(
            "RSA-SHA256",
            Buffer.from(`${header}.${payload}`),
            publicKey,
            Buffer.from(signature, "base64url")
          )
        ).toBeTruthy();
        return await Promise.resolve(
          Response.json({ token: "repository-read-token" })
        );
      },
      1_792_425_600_000
    );
    expect(token).toBe("repository-read-token");
  });

  it("fails closed when installation authentication is rejected", async () => {
    await expect(
      installationToken(
        credentials,
        async () =>
          await Promise.resolve(new Response("rejected", { status: 403 }))
      )
    ).rejects.toThrow("authentication failed: 403");
  });

  it("restricts reads to freshness checks without arbitrary GitHub paths", () => {
    expect(allowedGitHubPath("pulls/408")).toBeTruthy();
    expect(allowedGitHubPath("commits/main")).toBeTruthy();
    expect(
      allowedGitHubPath(
        "commits/1234567890123456789012345678901234567890/pulls"
      )
    ).toBeTruthy();
    for (const path of [
      "contents/.env",
      "../other/repo",
      "pulls/0",
      "pulls/408/comments",
      "commits/main?x=y",
      "https://example.com",
      "pulls/%2e%2e",
    ]) {
      expect(allowedGitHubPath(path)).toBeFalsy();
    }
  });
});
