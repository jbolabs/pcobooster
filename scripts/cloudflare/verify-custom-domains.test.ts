import { describe, expect, it } from "vitest";

import { verifyCustomDomains } from "./verify-custom-domains";

const respondWith =
  (response: Response): typeof fetch =>
  async () =>
    await Promise.resolve(response.clone());

const credentials = { accountId: "account-1", apiToken: "token-1" };

interface Attached {
  readonly hostname: string;
  readonly service: string;
  readonly enabled?: boolean;
}

/** Answers `GET /accounts/:id/workers/domains?hostname=` the way Cloudflare's API does. */
const cloudflareDomains = (attached: readonly Attached[]) => {
  const requests: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const hostname = new URL(request.url).searchParams.get("hostname");
    return await Promise.resolve(
      Response.json({
        success: true,
        errors: null,
        messages: null,
        result: attached
          .filter((domain) => domain.hostname === hostname)
          .map((domain) => ({
            id: "6b92018a",
            zone_id: "a43fafd2",
            zone_name: "pcobooster.com",
            environment: "production",
            ...domain,
          })),
      })
    );
  };
  return { fetchImpl, requests };
};

describe(verifyCustomDomains, () => {
  it("passes when every hostname is an enabled custom domain of the Worker", async () => {
    const { fetchImpl, requests } = cloudflareDomains([
      {
        hostname: "pcobooster.com",
        service: "pcobooster-prod-web",
        enabled: true,
      },
      {
        hostname: "www.pcobooster.com",
        service: "pcobooster-prod-web",
        enabled: true,
      },
    ]);
    await verifyCustomDomains(
      credentials,
      "pcobooster-prod-web",
      ["pcobooster.com", "www.pcobooster.com"],
      fetchImpl
    );
    expect(
      requests.map((request) => ({
        url: request.url,
        authorization: request.headers.get("authorization"),
      }))
    ).toStrictEqual([
      {
        url: "https://api.cloudflare.com/client/v4/accounts/account-1/workers/domains?hostname=pcobooster.com",
        authorization: "Bearer token-1",
      },
      {
        url: "https://api.cloudflare.com/client/v4/accounts/account-1/workers/domains?hostname=www.pcobooster.com",
        authorization: "Bearer token-1",
      },
    ]);
  });

  it("names each hostname that is detached, disabled, or routed to another Worker", async () => {
    const { fetchImpl } = cloudflareDomains([
      { hostname: "pcobooster.com", service: "pcobooster-staging-web" },
      {
        hostname: "app.pcobooster.com",
        service: "pcobooster-prod-web",
        enabled: false,
      },
    ]);
    await expect(
      verifyCustomDomains(
        credentials,
        "pcobooster-prod-web",
        ["pcobooster.com", "www.pcobooster.com", "app.pcobooster.com"],
        fetchImpl
      )
    ).rejects.toThrow(
      "Expected pcobooster-prod-web to serve pcobooster.com, www.pcobooster.com, app.pcobooster.com: " +
        "pcobooster.com routes to pcobooster-staging-web; " +
        "www.pcobooster.com is not attached to any Worker; " +
        "app.pcobooster.com is attached to pcobooster-prod-web but disabled"
    );
  });

  it("reports a rejected API read instead of treating it as a detached domain", async () => {
    const forbidden = respondWith(
      Response.json(
        {
          success: false,
          errors: [{ code: 10_000, message: "Authentication error" }],
          messages: [],
          result: null,
        },
        { status: 403 }
      )
    );
    await expect(
      verifyCustomDomains(
        credentials,
        "pcobooster-prod-web",
        ["pcobooster.com"],
        forbidden
      )
    ).rejects.toThrow(
      'Listing Worker custom domains for pcobooster.com failed (403): [{"code":10000,"message":"Authentication error"}]'
    );
  });
});
