import { useCallback, useMemo } from "react";

import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { readBrowserStorage } from "@/lib/browser-storage";
import { DEFAULT_PRACTICE_PREFS, practicePrefsSchema } from "@/lib/practice";
import type { PracticePrefs } from "@/lib/practice";
import { storedJson } from "@/lib/stored-json";

const STORAGE_KEY = "practice:prefs";
const stored = storedJson(practicePrefsSchema);

const parsePrefs = (raw: string | null): PracticePrefs =>
  stored.parse(raw) ?? DEFAULT_PRACTICE_PREFS;

/** Practice settings kept in this browser: chart text size and mode, and each song's capo. */
export const usePracticePrefs = () => {
  const [raw, setRaw] = useBrowserStorage(STORAGE_KEY);
  const prefs = useMemo(() => parsePrefs(raw), [raw]);
  const update = useCallback(
    (updater: (current: PracticePrefs) => PracticePrefs) => {
      const next = stored.stringify(
        updater(parsePrefs(readBrowserStorage(STORAGE_KEY)))
      );
      if (next !== undefined) {
        setRaw(next);
      }
    },
    [setRaw]
  );
  return [prefs, update] as const;
};
