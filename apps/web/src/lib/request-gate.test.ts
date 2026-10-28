import { describe, expect, it } from "vitest";

import { decideRequestGate, isDevAuthBypassEnabled } from "./request-gate";
import type { RequestGateInput } from "./request-gate";

const signedOut = (
  url: string,
  overrides: Partial<Omit<RequestGateInput, "url">> = {}
): RequestGateInput => ({
  url: new URL(url),
  handlerType: "router",
  hasSessionCookie: false,
  hasDemoSessionCookie: false,
  devAuthBypass: false,
  ...overrides,
});

const privateLinkHeaders = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

describe(decideRequestGate, () => {
  it.each([
    [
      "https://www.pcobooster.com/services/1/plans/2/lineup?teamId=3",
      "https://pcobooster.com/services/1/plans/2/lineup?teamId=3",
    ],
    ["http://www.pcobooster.com/", "https://pcobooster.com/"],
    [
      "https://www.pcobooster.com/api/v1/session",
      "https://pcobooster.com/api/v1/session",
    ],
  ])("permanently redirects %s to the apex", (url, location) => {
    expect(
      decideRequestGate(signedOut(url, { hasSessionCookie: true }))
    ).toStrictEqual({ action: "redirect", location, status: 308 });
  });

  it.each([
    "/",
    "/about",
    "/about/",
    "/privacy",
    "/terms",
    "/key-transitions",
    "/key-transitions/e-to-e-flat",
    "/marketing/assets/index.js",
  ])("serves the public marketing path %s without a session", (path) => {
    expect(
      decideRequestGate(signedOut(`https://pcobooster.com${path}`))
    ).toStrictEqual({ action: "continue", responseHeaders: {} });
  });

  it("keeps private demo links out of indexes and referrers", () => {
    expect(
      decideRequestGate(signedOut("https://pcobooster.com/demo/secret-key"))
    ).toStrictEqual({
      action: "continue",
      responseHeaders: privateLinkHeaders,
    });
  });

  it("adds the demo headers even when a session exists", () => {
    expect(
      decideRequestGate(
        signedOut("https://pcobooster.com/demo/secret-key", {
          hasSessionCookie: true,
        })
      )
    ).toStrictEqual({
      action: "continue",
      responseHeaders: privateLinkHeaders,
    });
  });

  it.each([
    "/api/auth/get-session",
    "/api/auth/callback/planning-center?code=1",
    // A prefix match; the API rejects unknown auth routes.
    "/api/authz",
    "/api/v1/session",
    "/api/v1/features",
    "/api/v1/demo/session",
    "/api/v1/accounts",
    "/api/v1/service-types/1/plans/2/items/order",
    "/api/updates/manifest",
    "/api/updates/assets/47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
    "/auth",
    "/auth?next=%2Fpeople",
    "/ingest/i/v0/e/",
    "/ingest/s/",
    "/ingest/static/recorder.js",
    "/ingest/array/phc_key/config",
    "/robots.txt",
    "/sitemap.xml",
  ])("lets signed-out visitors reach %s", (path) => {
    expect(
      decideRequestGate(signedOut(`https://pcobooster.com${path}`))
    ).toStrictEqual({ action: "continue", responseHeaders: {} });
  });

  it("lets server functions authorize themselves", () => {
    expect(
      decideRequestGate(
        signedOut("https://pcobooster.com/_serverFn/abc", {
          handlerType: "serverFn",
        })
      )
    ).toStrictEqual({ action: "continue", responseHeaders: {} });
  });

  it.each([
    [{ hasSessionCookie: true }],
    [{ hasDemoSessionCookie: true }],
    [{ devAuthBypass: true }],
  ])("serves product pages with %j", (overrides) => {
    expect(
      decideRequestGate(signedOut("https://pcobooster.com/services", overrides))
    ).toStrictEqual({ action: "continue", responseHeaders: {} });
  });

  it.each([
    ["/services", "/auth"],
    ["/people/12?month=2026-09", "/auth?next=%2Fpeople%2F12%3Fmonth%3D2026-09"],
    [
      "/services/1/plans/2/assign?teamId=3&positionId=4",
      "/auth?next=%2Fservices%2F1%2Fplans%2F2%2Fassign%3FteamId%3D3%26positionId%3D4",
    ],
    // Other API paths are gated, and API paths are never a return destination.
    ["/api/health", "/auth"],
    ["/api/updates", "/auth"],
    ["/api/updates/history", "/auth"],
    ["/authors", "/auth?next=%2Fauthors"],
    ["/demo", "/auth?next=%2Fdemo"],
  ])("sends signed-out visitors from %s to sign-in", (path, location) => {
    expect(
      decideRequestGate(signedOut(`https://pcobooster.com${path}`))
    ).toStrictEqual({ action: "redirect", location, status: 307 });
  });

  it("redirects on the request's own origin", () => {
    expect(
      decideRequestGate(signedOut("http://127.0.0.1:3001/people"))
    ).toStrictEqual({
      action: "redirect",
      location: "/auth?next=%2Fpeople",
      status: 307,
    });
  });
});

describe(isDevAuthBypassEnabled, () => {
  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["false", false],
    ["", false],
    [undefined, false],
  ])("maps %j in development to %s", (value, expected) => {
    expect(isDevAuthBypassEnabled(value, false)).toBe(expected);
  });

  it("never bypasses authentication in production builds", () => {
    expect(isDevAuthBypassEnabled("1", true)).toBeFalsy();
  });
});
