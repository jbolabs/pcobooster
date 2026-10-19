import { describe, expect, it } from "vitest";

import { proxyAnalytics } from "./analytics-proxy";

const upstream = (response: Response = new Response("ok")) => {
  const requests: Request[] = [];
  const send: typeof globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return await Promise.resolve(response);
  };
  return { requests, send };
};

describe(proxyAnalytics, () => {
  it.each(["/i/v0/e/?ip=1", "/s/?compression=gzip", "/flags/?v=2"])(
    "forwards %s with its exact payload and trusted client IP, without credentials",
    async (path) => {
      const { send, requests } = upstream();
      const response = await proxyAnalytics(
        new Request(`https://pcobooster.com/ingest${path}`, {
          method: "POST",
          headers: {
            cookie: "better-auth.session_token=secret",
            authorization: "Bearer secret",
            "proxy-authorization": "secret",
            "cf-access-jwt-assertion": "secret",
            "x-pcobooster-account": "private-account",
            "content-type": "application/octet-stream",
            "content-encoding": "gzip",
            "cf-connecting-ip": "192.0.2.8",
            "x-forwarded-for": "spoofed",
          },
          body: new Uint8Array([31, 139, 8, 0, 255]),
        }),
        send
      );
      const [request] = requests;
      expect({
        url: request?.url,
        method: request?.method,
        headers: Object.fromEntries(request?.headers ?? []),
        bytes: [...new Uint8Array(await request?.arrayBuffer())],
        redirect: request?.redirect,
        credentials: request?.credentials,
        status: response.status,
        cacheControl: response.headers.get("cache-control"),
      }).toStrictEqual({
        url: `https://us.i.posthog.com${path}`,
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "content-encoding": "gzip",
          "x-forwarded-for": "192.0.2.8",
        },
        bytes: [31, 139, 8, 0, 255],
        redirect: "manual",
        credentials: "omit",
        status: 200,
        cacheControl: "no-store",
      });
    }
  );

  it.each([
    "/static/recorder.js?v=1",
    "/array/phc_key/config.js",
    "/array/phc_key/config",
  ])(
    "routes %s to the assets host, preserving content and cache headers",
    async (path) => {
      const { send, requests } = upstream(
        new Response("asset", {
          headers: {
            "cache-control": "public, max-age=3600",
            "content-type": "text/javascript",
            "set-cookie": "unwanted=1",
          },
        })
      );
      const response = await proxyAnalytics(
        new Request(`https://pcobooster.com/ingest${path}`),
        send
      );
      expect({
        url: requests[0]?.url,
        method: requests[0]?.method,
        body: await response.text(),
        cacheControl: response.headers.get("cache-control"),
        contentType: response.headers.get("content-type"),
        cookie: response.headers.get("set-cookie"),
      }).toStrictEqual({
        url: `https://us-assets.i.posthog.com${path}`,
        method: "GET",
        body: "asset",
        cacheControl: "public, max-age=3600",
        contentType: "text/javascript",
        cookie: null,
      });
    }
  );

  it("keeps even a double-slash path on the fixed PostHog host", async () => {
    const { send, requests } = upstream(
      new Response("bad event", { status: 400 })
    );
    const response = await proxyAnalytics(
      new Request("https://pcobooster.com/ingest//evil.example/e/"),
      send
    );
    expect([
      requests[0]?.url,
      response.status,
      await response.text(),
    ]).toStrictEqual([
      "https://us.i.posthog.com//evil.example/e/",
      400,
      "bad event",
    ]);
  });

  it.each([
    ["/ingestion/e/", "POST", 404],
    ["/ingest/e/", "DELETE", 405],
  ])(
    "rejects %s %s outside the proxy boundary",
    async (path, method, status) => {
      const { send, requests } = upstream();
      const response = await proxyAnalytics(
        new Request(`https://pcobooster.com${path}`, { method }),
        send
      );
      expect(response.status).toBe(status);
      expect(requests).toHaveLength(0);
    }
  );
});
