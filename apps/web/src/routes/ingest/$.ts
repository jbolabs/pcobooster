import { createFileRoute } from "@tanstack/react-router";

import { proxyAnalytics } from "@/server/analytics-proxy";

/** Marketing, auth, and product analytics share this public same-origin route. */
export const Route = createFileRoute("/ingest/$")({
  server: {
    handlers: {
      ANY: async ({ request }) =>
        await proxyAnalytics(request, globalThis.fetch),
    },
  },
});
