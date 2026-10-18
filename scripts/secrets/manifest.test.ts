import { describe, expect, it } from "vitest";

import {
  commandEnvironment,
  selectScopeValues,
  storedRuntimeKeys,
  storeSecretName,
} from "./manifest";

describe("secret ownership boundaries", () => {
  it("replaces inherited church credentials with only the sandbox token", () => {
    expect(
      commandEnvironment(
        "sandbox",
        {
          PATH: "/usr/bin",
          PLANNING_CENTER_CLIENT: "church-client",
          PLANNING_CENTER_PAT: "church-pat",
          CLOUDFLARE_API_TOKEN: "deployment-token",
        },
        {
          PLANNING_CENTER_CLIENT: "sandbox-client",
          PLANNING_CENTER_PAT: "sandbox-pat",
        }
      )
    ).toStrictEqual({
      PATH: "/usr/bin",
      PLANNING_CENTER_CLIENT: "sandbox-client",
      PLANNING_CENTER_PAT: "sandbox-pat",
    });
  });

  it("keeps identical app keys distinct by app and environment", () => {
    expect([
      storeSecretName("pcobooster", "prod", "auth", "BETTER_AUTH_SECRET"),
      storeSecretName("pcobooster", "preview", "auth", "BETTER_AUTH_SECRET"),
      storeSecretName("anotherapp", "prod", "auth", "BETTER_AUTH_SECRET"),
    ]).toStrictEqual([
      "pcobooster__prod__auth__BETTER_AUTH_SECRET",
      "pcobooster__preview__auth__BETTER_AUTH_SECRET",
      "anotherapp__prod__auth__BETTER_AUTH_SECRET",
    ]);
    expect(() => storeSecretName("other__app", "prod", "auth", "KEY")).toThrow(
      "Invalid secret namespace component"
    );
  });

  it("keeps local PATs, production signing keys, and release credentials out of cloud commands", () => {
    expect(
      commandEnvironment(
        "cloud",
        {
          PATH: "/usr/bin",
          PLANNING_CENTER_PAT: "personal",
          ASC_KEY_P8_BASE64: "signing",
          ASC_KEY_PATH: "/private/signing.p8",
          CLOUDFLARE_API_TOKEN: "deploy",
          CLOUDFLARE_TOKEN_ADMIN_API_TOKEN: "administrator",
          CLOUDFLARE_API_KEY: "global-key",
          BETTER_AUTH_SECRET: "production",
          INFISICAL_TOKEN: "old-token",
          DEV_AUTH_BYPASS: "1",
          PRESENTATION_MODE: "1",
        },
        {
          BETTER_AUTH_SECRET: "cloud-session",
          PLANNING_CENTER_OAUTH_CLIENT_ID: "cloud-client",
          PLANNING_CENTER_OAUTH_CLIENT_SECRET: "cloud-oauth",
          PLANNING_CENTER_PAT: "wrong-scope",
        }
      )
    ).toStrictEqual({
      PATH: "/usr/bin",
      CLOUDFLARE_ACCOUNT_ID: "00000000000000000000000000000000",
      CLOUDFLARE_API_TOKEN: "local-development-never-reaches-cloudflare",
      BETTER_AUTH_SECRET: "cloud-session",
      PLANNING_CENTER_OAUTH_CLIENT_ID: "cloud-client",
      PLANNING_CENTER_OAUTH_CLIENT_SECRET: "cloud-oauth",
    });
  });

  it("imports only Apple keys into the signing scope", () => {
    expect(
      selectScopeValues("apple", {
        ASC_KEY_ID: "key-id",
        ASC_ISSUER_ID: "issuer-id",
        ASC_KEY_P8_BASE64: "private-key",
        PLANNING_CENTER_PAT: "personal",
        DATABASE_URL: "recovery",
        CLOUDFLARE_API_TOKEN: "deploy",
      })
    ).toStrictEqual({
      ASC_KEY_ID: "key-id",
      ASC_ISSUER_ID: "issuer-id",
      ASC_KEY_P8_BASE64: "private-key",
    });
  });

  it("gives update publishing the signing key and no Cloudflare token", () => {
    expect(
      commandEnvironment(
        "mobile-updates",
        { PATH: "/usr/bin", CLOUDFLARE_API_TOKEN: "inherited-deploy" },
        {
          UPDATES_SIGNING_KEY_PEM_BASE64: "signing-key",
          CLOUDFLARE_API_TOKEN: "deploy",
          ASC_KEY_P8_BASE64: "apple-key",
        }
      )
    ).toStrictEqual({
      PATH: "/usr/bin",
      UPDATES_SIGNING_KEY_PEM_BASE64: "signing-key",
    });
  });

  it("makes previews consume only the broker and provider credentials", () => {
    expect(storedRuntimeKeys(false)).toStrictEqual([
      "OAUTH_PROXY_SECRET",
      "PLANNING_CENTER_OAUTH_CLIENT_ID",
      "PLANNING_CENTER_OAUTH_CLIENT_SECRET",
    ]);
  });
});
