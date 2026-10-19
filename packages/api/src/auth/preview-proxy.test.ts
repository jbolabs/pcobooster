import { hkdfSync } from "node:crypto";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { createPreviewProxy } from "./preview-proxy";

const productionOrigin = "https://production.example.com";
const previewOrigin = "https://preview.example.net";
const proxySecret =
  "synthetic-proxy-secret-0123456789abcdefghijklmnopqrstuvwxyz";
/** Better Auth 1.7.10 isolates each OAuth proxy ciphertext by purpose. */
const proxyEncryptionKey = (purpose: string): string =>
  Buffer.from(
    hkdfSync(
      "sha256",
      proxySecret,
      "better-auth:oauth-encryption:v1",
      `better-auth:${purpose}:v1`,
      32
    )
  ).toString("hex");
/** Every field a decoded JSON object has beyond the ones a test reads. */
const otherFields = [Schema.Record(Schema.String, Schema.Unknown)] as const;
const decodeStatePackage = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.StructWithRest(
      Schema.Struct({ stateCookie: Schema.String }),
      otherFields
    )
  )
);
const decodeState = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.StructWithRest(
      Schema.Struct({
        idTokenNonce: Schema.optional(Schema.String),
        callbackURL: Schema.String,
      }),
      otherFields
    )
  )
);
const decodePayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.StructWithRest(
      Schema.Struct({ callbackURL: Schema.String }),
      otherFields
    )
  )
);
const decodeText = Schema.decodeUnknownSync(Schema.String);

const alterState = async (state: string, scenario: string): Promise<string> => {
  const envelope = decodeStatePackage(
    await symmetricDecrypt({
      key: proxyEncryptionKey("oauth-proxy-package"),
      data: state,
    })
  );
  const { idTokenNonce, ...contents } = decodeState(
    await symmetricDecrypt({
      key: proxyEncryptionKey("oauth-proxy-state"),
      data: envelope.stateCookie,
    })
  );
  const nonce =
    scenario === "mismatched-nonce" ? "different-nonce" : idTokenNonce;
  const callbackURL =
    scenario === "untrusted-receiver"
      ? "https://untrusted.example.org/api/auth/callback/planning-center/oauth-proxy?callbackURL=%2F"
      : contents.callbackURL;
  const altered =
    scenario === "missing-nonce" || nonce === undefined
      ? { ...contents, callbackURL }
      : { ...contents, callbackURL, idTokenNonce: nonce };
  return await symmetricEncrypt({
    key: proxyEncryptionKey("oauth-proxy-package"),
    data: JSON.stringify({
      ...envelope,
      stateCookie: await symmetricEncrypt({
        key: proxyEncryptionKey("oauth-proxy-state"),
        data: JSON.stringify(altered),
      }),
    }),
  });
};

const runScenario = async (scenario: string) => {
  const productionDb = { user: [], session: [], account: [], verification: [] };
  const previewDb = { user: [], session: [], account: [], verification: [] };
  let issuedNonce: string | undefined;
  let seenNonce: string | undefined;
  let tokenCalls = 0;
  const provider = {
    id: "planning-center",
    name: "Synthetic provider",
    issuer: "https://idp.example.com",
    requiresIdTokenNonce: true,
    accountSubject: () => "test-person",
    createAuthorizationURL: async ({
      state,
      redirectURI,
      idTokenNonce,
    }: {
      state: string;
      redirectURI: string;
      idTokenNonce?: string;
    }) => {
      issuedNonce = idTokenNonce;
      const url = new URL("https://idp.example.com/authorize");
      url.searchParams.set("state", state);
      url.searchParams.set("redirect_uri", redirectURI);
      return await Promise.resolve(url);
    },
    validateAuthorizationCode: async () => {
      tokenCalls += 1;
      return await Promise.resolve({
        accessToken: "synthetic-token",
        scopes: ["openid"],
      });
    },
    getUserInfo: async (tokens: { expectedIdTokenNonce?: string }) => {
      seenNonce = tokens.expectedIdTokenNonce;
      return await Promise.resolve(
        seenNonce === issuedNonce
          ? {
              user: {
                name: "Test Person",
                email: "test@example.invalid",
                emailVerified: true,
              },
              data: { sub: "test-person" },
            }
          : null
      );
    },
  };
  const instance = (
    origin: string,
    database: typeof productionDb,
    production: boolean
  ) =>
    betterAuth({
      baseURL: origin,
      secret: `${production ? "production" : "preview"}-synthetic-auth-secret-12345678901234567890`,
      database: memoryAdapter(database),
      trustedOrigins: [productionOrigin, previewOrigin],
      logger: { disabled: true },
      plugins: [
        {
          id: "test-provider",
          init: () => ({ context: { socialProviders: [provider] } }),
        },
        createPreviewProxy({
          currentURL: origin,
          productionURL: productionOrigin,
          secret: proxySecret,
          production,
        }),
      ],
    });
  const production = instance(productionOrigin, productionDb, true);
  const preview = instance(previewOrigin, previewDb, false);
  const signIn = await preview.handler(
    new Request(`${previewOrigin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: previewOrigin },
      body: JSON.stringify({
        provider: "planning-center",
        callbackURL: "/admin",
        errorCallbackURL: `${previewOrigin}/auth`,
        disableRedirect: true,
      }),
    })
  );
  const authorization = Schema.decodeUnknownSync(
    Schema.Struct({ url: Schema.String })
  )(await signIn.json());
  const providerUrl = new URL(authorization.url);
  const state = await alterState(
    decodeText(providerUrl.searchParams.get("state")),
    scenario
  );
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const callback = new URL(
    `${productionOrigin}/api/auth/callback/planning-center`
  );
  callback.searchParams.set("code", "synthetic");
  callback.searchParams.set("state", state);
  callback.searchParams.set(
    "iss",
    scenario === "wrong-issuer" ? "https://wrong.example.org" : provider.issuer
  );
  const brokerResponse = await production.handler(new Request(callback));
  const location = new URL(
    decodeText(brokerResponse.headers.get("location")),
    productionOrigin
  );
  let error = location.searchParams.get("error");
  let destination: string | null = null;
  let hostOnly = false;
  let replayError: string | null = null;
  if (location.searchParams.has("profile")) {
    if (scenario === "cross-origin-completion") {
      const encrypted = decodeText(location.searchParams.get("profile"));
      const payload = decodePayload(
        await symmetricDecrypt({
          key: proxyEncryptionKey("oauth-proxy-profile"),
          data: encrypted,
        })
      );
      location.searchParams.set(
        "profile",
        await symmetricEncrypt({
          key: proxyEncryptionKey("oauth-proxy-profile"),
          data: JSON.stringify({
            ...payload,
            callbackURL: `${productionOrigin}/admin`,
          }),
        })
      );
    }
    let cookieHeader = cookie;
    if (scenario === "missing-cookie") {
      cookieHeader = "";
    } else if (scenario === "wrong-cookie") {
      cookieHeader = "better-auth.state=wrong";
    }
    const completion = await preview.handler(
      new Request(location, { headers: { cookie: cookieHeader } })
    );
    destination = completion.headers.get("location");
    error = new URL(decodeText(destination), previewOrigin).searchParams.get(
      "error"
    );
    hostOnly = completion.headers
      .getSetCookie()
      .every((value) => !value.toLowerCase().includes("domain="));
    if (scenario === "valid") {
      const replay = await preview.handler(
        new Request(location, { headers: { cookie } })
      );
      replayError = new URL(
        decodeText(replay.headers.get("location")),
        previewOrigin
      ).searchParams.get("error");
    }
  }
  const productionCompletionStatuses = await Promise.all(
    [
      "/callback/arbitrary/oauth-proxy?callbackURL=%2F",
      "/oauth-proxy-callback?callbackURL=%2F",
    ].map(async (path) => {
      const response = await production.handler(
        new Request(`${productionOrigin}/api/auth${path}`)
      );
      return response.status;
    })
  );
  return {
    error,
    destination,
    hostOnly,
    replayError,
    tokenCalls,
    expectedNonceForwarded:
      seenNonce === issuedNonce && seenNonce !== undefined,
    providerRedirect: providerUrl.searchParams.get("redirect_uri"),
    previewUsers: previewDb.user.length,
    previewSessions: previewDb.session.length,
    productionUsers: productionDb.user.length,
    productionSessions: productionDb.session.length,
    productionCompletionStatuses,
  };
};

describe("preview OAuth boundary", () => {
  it("completes only in the initiating preview, binds the OIDC nonce, and rejects replay", async () => {
    await expect(runScenario("valid")).resolves.toMatchObject({
      error: null,
      destination: "/admin",
      hostOnly: true,
      replayError: "state_mismatch",
      expectedNonceForwarded: true,
      providerRedirect: `${productionOrigin}/api/auth/callback/planning-center`,
      previewUsers: 1,
      previewSessions: 1,
      productionUsers: 0,
      productionSessions: 0,
      productionCompletionStatuses: [404, 404],
    });
  });

  it.each([
    ["wrong-issuer", "issuer_mismatch"],
    ["missing-nonce", "nonce_binding_missing"],
    ["untrusted-receiver", "invalid_callback_url"],
  ])("rejects %s before exchanging credentials", async (scenario, error) => {
    await expect(runScenario(scenario)).resolves.toMatchObject({
      error,
      tokenCalls: 0,
      previewUsers: 0,
      previewSessions: 0,
      productionUsers: 0,
      productionSessions: 0,
    });
  });

  it.each([
    ["mismatched-nonce", "unable_to_get_user_info"],
    ["cross-origin-completion", "invalid_callback_url"],
    ["missing-cookie", "state_mismatch"],
    ["wrong-cookie", "state_mismatch"],
  ])(
    "rejects %s without creating an account or session",
    async (scenario, error) => {
      await expect(runScenario(scenario)).resolves.toMatchObject({
        error,
        previewUsers: 0,
        previewSessions: 0,
        productionUsers: 0,
        productionSessions: 0,
      });
    }
  );
});
