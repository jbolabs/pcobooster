import { describe, expect, it } from "vitest";

import { forwardRequest, serveStaticPage } from "./passthrough";
import type { ServiceFetcher } from "./server-api";

const recordingService = (response: Response = new Response("ok")) => {
  const requests: Request[] = [];
  const service: ServiceFetcher = {
    fetch: async (request) => {
      requests.push(request);
      return await Promise.resolve(response);
    },
  };
  return { service, requests };
};

describe(forwardRequest, () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "forwards a %s with its URL, headers, and body unchanged",
    async (method) => {
      const { service, requests } = recordingService();
      const url =
        "https://pcobooster.com/api/v1/service-types/1/plans/2/items/3?x=1";
      const withBody = new Request(url, {
        method: "POST",
        headers: { cookie: "a=b", "content-type": "application/json" },
        body: JSON.stringify({ title: "Welcome" }),
      });
      await forwardRequest(service, new Request(withBody, { method }));
      const [request] = requests;
      expect({
        method: request?.method,
        url: request?.url,
        cookie: request?.headers.get("cookie"),
        contentType: request?.headers.get("content-type"),
        body: await request?.text(),
      }).toStrictEqual({
        method,
        url,
        cookie: "a=b",
        contentType: "application/json",
        body: JSON.stringify({ title: "Welcome" }),
      });
    }
  );

  it("returns redirects to the browser instead of following them", async () => {
    const { service, requests } = recordingService();
    await forwardRequest(
      service,
      new Request("https://pcobooster.com/api/auth/callback/planning-center")
    );
    expect(requests[0]?.redirect).toBe("manual");
  });

  it("returns the service response as is", async () => {
    const upstream = new Response("created", {
      status: 201,
      headers: { "set-cookie": "session=1; HttpOnly" },
    });
    const { service } = recordingService(upstream);
    const response = await forwardRequest(
      service,
      new Request("https://pcobooster.com/api/auth/sign-in", { method: "POST" })
    );
    expect(response).toBe(upstream);
  });
});

describe(serveStaticPage, () => {
  it("fetches the staged file on the request's origin", async () => {
    const { service, requests } = recordingService();
    await serveStaticPage(
      service,
      new Request("https://pcobooster.com/about?ref=home", { method: "HEAD" }),
      "/marketing/about.html"
    );
    const [request] = requests;
    expect(request?.url).toBe("https://pcobooster.com/marketing/about.html");
    expect(request?.method).toBe("GET");
  });
});
