import { existsSync } from "node:fs";
import nodePath from "node:path";

import { describe, expect, it } from "vitest";

import { navigationPath, navigationTab } from "./navigation-path";

// Route files are the system boundary: a correct URL without a mounted screen is a broken link.
const mounted = (path: string) => {
  const file = path
    .split("?")[0]
    .replace("/1101/", "/[service-type-id]/")
    .replace("/881261004", "/[plan-id]")
    .replace("/5501", "/[songId]")
    .replace("/7001", "/[person-id]");
  const root = nodePath.resolve(
    import.meta.dirname,
    "../../app/(tabs)",
    `.${file}`
  );
  return existsSync(`${root}.tsx`) || existsSync(`${root}/index.tsx`);
};

describe("native navigation ownership", () => {
  it("keeps search results and subsequent chart preparation in Search", () => {
    expect(navigationPath("/songs/5501", "search")).toBe("/search/songs/5501");
    expect(
      navigationPath("/songs/5501/chart?arrangement=55011", "search")
    ).toBe("/search/songs/5501/chart?arrangement=55011");
    expect(navigationTab(["(tabs)", "search", "songs", "[songId]"])).toBe(
      "search"
    );
  });

  it("keeps a plan opened from a person's schedule in People", () => {
    expect(
      navigationPath("/services/1101/plans/881261004/teams", "people")
    ).toBe("/people/services/1101/plans/881261004/teams");
    expect(navigationPath("/services/1101/plans/881261004", "services")).toBe(
      "/services/1101/plans/881261004"
    );
  });

  it.each(["services", "people", "songs", "search"] as const)(
    "mounts preparation and assignment destinations in %s",
    (tab) => {
      const base = "/services/1101/plans/881261004";
      const paths = [
        base,
        `${base}/assign`,
        `${base}/songs/5501`,
        `${base}/songs/5501/chart`,
        `${base}/songs/5501/pdf`,
        `${base}/songs/5501/files`,
      ];
      expect(
        paths.map((path) => mounted(navigationPath(path, tab)))
      ).toStrictEqual([true, true, true, true, true, true]);
    }
  );

  it("mounts all searchable entity types", () => {
    expect(
      ["/songs/5501", "/people/7001", "/services/1101/plans/881261004"].map(
        (path) => mounted(navigationPath(path, "search"))
      )
    ).toStrictEqual([true, true, true]);
  });
});
