import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  parseThemePreference,
  resolveTheme,
  themeInitScript,
} from "./theme";
import type { ThemeRoot } from "./theme";

const createRoot = (initialClasses: string[] = []) => {
  const classes = new Set(initialClasses);
  const root: ThemeRoot = {
    classList: {
      add: (name) => {
        classes.add(name);
      },
      remove: (...names) => {
        for (const name of names) {
          classes.delete(name);
        }
      },
    },
    style: { colorScheme: "" },
  };
  return { root, classes };
};

describe(parseThemePreference, () => {
  it.each(["light", "dark", "system"] as const)("keeps %s", (value) => {
    expect(parseThemePreference(value)).toBe(value);
  });

  it.each([null, "", "sepia"])("treats %j as system", (value) => {
    expect(parseThemePreference(value)).toBe("system");
  });
});

describe(resolveTheme, () => {
  it("follows explicit choices", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the operating system for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe(applyResolvedTheme, () => {
  it("swaps the theme class and color scheme", () => {
    const { root, classes } = createRoot(["light", "other"]);
    applyResolvedTheme(root, "dark");
    expect([...classes].toSorted()).toStrictEqual(["dark", "other"]);
    expect(root.style.colorScheme).toBe("dark");
  });
});

describe("theme init script", () => {
  const runScript = (stored: string | null, systemDark: boolean) => {
    const { root, classes } = createRoot();
    runInNewContext(themeInitScript, {
      document: { documentElement: root },
      localStorage: {
        getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null),
      },
      matchMedia: (query: string) => ({
        matches: query === "(prefers-color-scheme: dark)" && systemDark,
      }),
    });
    return { classes: [...classes], colorScheme: root.style.colorScheme };
  };

  it.each([
    ["dark", false, "dark"],
    ["light", true, "light"],
    ["system", true, "dark"],
    [null, false, "light"],
    ["sepia", true, "dark"],
  ] as const)(
    "applies %j with a dark system of %s as %s before hydration",
    (stored, systemDark, expected) => {
      expect(runScript(stored, systemDark)).toStrictEqual({
        classes: [expected],
        colorScheme: expected,
      });
    }
  );

  it("falls back to the system theme when storage is blocked", () => {
    const { root, classes } = createRoot();
    runInNewContext(themeInitScript, {
      document: { documentElement: root },
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
      },
      matchMedia: () => ({ matches: true }),
    });
    expect([...classes]).toStrictEqual(["dark"]);
  });
});
