import {
  captureAnalyticsException,
  initializeAnalytics,
} from "@pcobooster/analytics/client";
import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

// Start's default client entry, preceded by sign-in analytics. Product pages initialize after
// a successful account response instead, which rules out read-only demo sessions
// (`hooks/use-account-panel.ts`).
if (window.location.pathname === "/auth") {
  initializeAnalytics(import.meta.env.VITE_POSTHOG_KEY, import.meta.env.PROD);
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
    {
      // The router's error screen is TanStack's CatchBoundary. An error it catches never
      // reaches the global handlers that exception autocapture listens to, so report it
      // here. Uncaught errors do reach those handlers.
      onCaughtError: (error, errorInfo) => {
        console.error(error, errorInfo.componentStack);
        captureAnalyticsException(
          error instanceof Error ? error : new Error(String(error))
        );
      },
    }
  );
});
