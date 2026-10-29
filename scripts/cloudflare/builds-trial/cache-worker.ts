import type { R2Bucket } from "@cloudflare/workers-types";

interface CacheEnvironment {
  CACHE: R2Bucket;
  TOKEN: string;
}

const artifactPath = /^\/v8\/artifacts\/(?<hash>[a-f0-9]{16,64})$/u;
const namespace = "linux-x64-bun1.4.2-node24.11.1-v1";

/** Dedicated trial cache. No production clients or unauthenticated artifact access. */
export default {
  async fetch(request: Request, env: CacheEnvironment): Promise<Response> {
    if (request.headers.get("Authorization") !== `Bearer ${env.TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/v8/artifacts/status" && request.method === "GET") {
      return Response.json({ status: "enabled" });
    }
    if (url.pathname === "/v8/artifacts/events" && request.method === "POST") {
      return new Response(null, { status: 204 });
    }
    const hash = artifactPath.exec(url.pathname)?.groups?.hash;
    if (hash === undefined) {
      return new Response("Not found", { status: 404 });
    }
    const key = `${namespace}/${hash}`;
    if (request.method === "PUT") {
      const body = await request.arrayBuffer();
      if (body.byteLength > 5 * 1024 * 1024) {
        return new Response("Validation artifact too large", { status: 413 });
      }
      await env.CACHE.put(key, body);
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const object = await env.CACHE.get(key);
      if (!object) {
        return new Response("Cache miss", { status: 404 });
      }
      return new Response(
        request.method === "HEAD" ? null : await object.arrayBuffer(),
        {
          headers: {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
          },
        }
      );
    }
    return new Response("Method not allowed", { status: 405 });
  },
};
