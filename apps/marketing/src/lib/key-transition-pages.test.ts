import { describe, expect, it } from "vitest";

import {
  KEY_PAIRS,
  keyLongName,
  pairFromSlug,
  pairPath,
} from "./key-transition-pages";

describe(pairPath, () => {
  it.each([
    [{ from: "G", to: "Bb" }, "/key-transitions/g-to-b-flat"],
    [{ from: "C#m", to: "E" }, "/key-transitions/c-sharp-minor-to-e"],
    [{ from: "Ebm", to: "F#" }, "/key-transitions/e-flat-minor-to-f-sharp"],
  ] as const)("gives %o the page %s", (pair, path) => {
    expect(pairPath(pair)).toBe(path);
  });

  it("gives every one of the 24 keys its own page into each of the 24", () => {
    // 12 major and 12 minor keys, each into every key including itself.
    expect(KEY_PAIRS).toHaveLength(576);
    expect(new Set(KEY_PAIRS.map((pair) => pairPath(pair))).size).toBe(576);
  });
});

describe(pairFromSlug, () => {
  it("reads a page's pair back from its URL", () => {
    expect(pairFromSlug("b-flat-minor-to-d-flat")).toStrictEqual({
      from: "Bbm",
      to: "Db",
    });
  });

  it("reads only the slugs it writes", () => {
    expect(pairFromSlug("g-to-b-flat")).toStrictEqual({ from: "G", to: "Bb" });
    expect(
      ["g-to-h", "g-to-b-flat-major", "G-to-Bb", "g"].map((slug) =>
        pairFromSlug(slug)
      )
    ).toStrictEqual([undefined, undefined, undefined, undefined]);
  });
});

describe(keyLongName, () => {
  it.each([
    ["Bb", "B-flat major"],
    ["C#m", "C-sharp minor"],
    ["Am", "A minor"],
  ] as const)("writes %s as %s", (choice, name) => {
    expect(keyLongName(choice)).toBe(name);
  });
});
