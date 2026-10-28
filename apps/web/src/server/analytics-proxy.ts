/** PostHog is the only upstream; browser credentials never leave the product origin. */
const forwardedHeaders = [
  "accept",
  "accept-encoding",
  "content-type",
  "content-encoding",
  "user-agent",
  "if-none-match",
  "if-modified-since",
] as const;

export const proxyAnalytics = async (
  request: Request,
  send: (url: URL, init: RequestInit) => Promise<Response>
): Promise<Response> => {
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith("/ingest/")) {
    return new Response("Not found", { status: 404 });
  }
  if (!["GET", "HEAD", "POST", "OPTIONS"].includes(request.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD, POST, OPTIONS" },
    });
  }
  const pathname = incoming.pathname.slice("/ingest".length);
  const asset =
    pathname.startsWith("/static/") || pathname.startsWith("/array/");
  const upstream = new URL(
    asset ? "https://us-assets.i.posthog.com" : "https://us.i.posthog.com"
  );
  upstream.pathname = pathname;
  upstream.search = incoming.search;
  const headers = new Headers();
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  // PostHog turns replay on only for an Origin in the project's recording domains, and
  // browsers omit Origin on same-origin GETs such as the remote config script.
  headers.set("origin", incoming.origin);
  // Cloudflare supplies this header; never trust a caller's X-Forwarded-For chain.
  const ip = request.headers.get("cf-connecting-ip");
  if (ip !== null) {
    headers.set("x-forwarded-for", ip);
  }
  const response = await send(upstream, {
    method: request.method,
    headers,
    // Buffer as PostHog's Worker guide requires for encoded SDK payloads.
    body: request.method === "POST" ? await request.arrayBuffer() : null,
    redirect: "manual",
    credentials: "omit",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
  });
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("set-cookie");
  if (!asset) {
    responseHeaders.set("cache-control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
