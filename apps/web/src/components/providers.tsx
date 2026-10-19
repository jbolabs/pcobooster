import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { useIsMobile } from "@/hooks/use-mobile";

/** App-wide providers. The router supplies the query client (`src/router.tsx`). */
export const Providers = ({ children }: { children: ReactNode }) => {
  const isMobile = useIsMobile();
  return (
    <HotkeysProvider>
      <ThemeProvider>
        {children}
        {import.meta.env.DEV ? (
          <ReactQueryDevtools
            initialIsOpen={false}
            buttonPosition="bottom-right"
          />
        ) : null}
        <Toaster richColors position={isMobile ? "top-center" : undefined} />
      </ThemeProvider>
    </HotkeysProvider>
  );
};
