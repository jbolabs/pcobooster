import { captureAnalytics } from "@pcobooster/analytics/client";
import { makeProductClient } from "@pcobooster/client/product-client";
import type { ProductClient } from "@pcobooster/client/product-client";

import { requestScheduler } from "@/lib/request-priority";
import { measureWorkflow } from "@/lib/workflow-analytics";

let tabClient: ProductClient | undefined;

/**
 * The tab's one API client, built on first call: route modules also load during SSR, where
 * there is no `window` and SSR has its own client (`server/server-api.ts`). The API is on this
 * origin: the product Worker forwards `/api/*` to it.
 */
const sharedClient = (): ProductClient => {
  tabClient ??= makeProductClient({
    url: window.location.origin,
    client: "web",
    credentials: "include",
  });
  return tabClient;
};

/**
 * Every browser call to the API: `productClient.run((api) => api.people.search(...), options)`.
 * Interactive calls hold speculative work back until they settle, and writes are measured for
 * workflow analytics under the procedure the client names from the route table.
 */
export const productClient: Pick<ProductClient, "run"> = {
  run: async (call, options = {}) =>
    await requestScheduler.track(
      options.priority ?? "interactive",
      async () =>
        await measureWorkflow(
          async (named) =>
            await sharedClient().run(call, {
              ...options,
              onProcedure: (procedure) => {
                named(procedure);
                options.onProcedure?.(procedure);
              },
            }),
          captureAnalytics
        )
    ),
};
