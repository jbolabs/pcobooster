import { captureAnalyticsException } from "@pcobooster/analytics/client";
import {
  readRetryDelay,
  retryTransientReadFailure,
} from "@pcobooster/client/query";
import { MutationCache, QueryClient, hashKey } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { discardApiCachesFromOlderBuilds } from "@/lib/account-scoped-caches";
import { INTENT_PREFETCH_DWELL_MS } from "@/lib/intent-prefetch";
import { createReadErrorCache } from "@/lib/read-error-analytics";
import { parseSearch, stringifySearch } from "@/lib/search-params";
import { browserSessionExpiry } from "@/lib/session-expiry";
import { routeTree } from "@/routeTree.gen";

const QUERY_GC_TIME_MS = 30 * 60 * 1000;

/**
 * Presentation mode renders fictional data, so its queries live in their own namespace and
 * never mix with live data from the same browser.
 */
const createQueryClient = (presentationScope: string): QueryClient => {
  // A 401 on any read or write means the session or Planning Center connection ended.
  const expireSession = browserSessionExpiry();
  return new QueryClient({
    queryCache: createReadErrorCache(captureAnalyticsException, expireSession),
    mutationCache: new MutationCache({ onError: expireSession }),
    defaultOptions: {
      queries: {
        gcTime: QUERY_GC_TIME_MS,
        queryKeyHashFn: (queryKey) => hashKey([presentationScope, ...queryKey]),
        refetchOnWindowFocus: false,
        retry: retryTransientReadFailure,
        retryDelay: readRetryDelay,
      },
    },
  });
};

/** Start creates a router, and so a query client, for each server request. */
export const getRouter = () => {
  // Before any query reads browser storage.
  discardApiCachesFromOlderBuilds();
  const queryClient = createQueryClient(
    import.meta.env.VITE_PRESENTATION_SCOPE
  );
  const router = createRouter({
    routeTree,
    context: { queryClient },
    parseSearch,
    stringifySearch,
    defaultPreload: "intent",
    // Links preload after the same dwell as row prefetches, so passing the pointer over
    // a link never preloads it. Route loaders fetch no Planning Center data today.
    defaultPreloadDelay: INTENT_PREFETCH_DWELL_MS,
    // Query owns data freshness; preloading only warms route code.
    defaultPreloadStaleTime: 0,
    // Show route skeletons as soon as a navigation waits.
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    scrollRestoration: true,
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
};
