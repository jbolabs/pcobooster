import { useSyncExternalStore } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { subscribeBrowserStorage } from "@/lib/browser-storage";
import { readDataMode, switchDataMode } from "@/lib/worst-case-data";

/**
 * Development only: flips every API answer between real data and the worst case
 * (`lib/worst-case-data.ts`). It sits outside the design under test, bottom center.
 */
export const WorstCaseDataToggle = () => {
  const current = useSyncExternalStore(
    subscribeBrowserStorage,
    readDataMode,
    () => "demo"
  );
  return (
    <Tabs
      className="fixed bottom-[max(--spacing(3),env(safe-area-inset-bottom))] left-1/2 z-100 -translate-x-1/2"
      value={current}
      onValueChange={(value) => {
        const mode = value === "worst" ? "worst" : "demo";
        if (mode !== current) {
          switchDataMode(mode);
        }
      }}
    >
      <TabsList aria-label="Development data" className="h-8">
        <TabsTrigger value="demo">
          {import.meta.env.VITE_DEVELOPMENT_PROFILE}
        </TabsTrigger>
        <TabsTrigger value="worst">Worst case</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};
