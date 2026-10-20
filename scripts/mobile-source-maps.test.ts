import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

import {
  bundleDebugId,
  directoryMapProblems,
  entryOrderProblems,
  mapsIn,
  recordClonedMap,
  releaseMapProblems,
  sha256,
  summarizeSourceMap,
} from "../apps/mobile/scripts/source-maps";
import type { ReleaseMaps } from "../apps/mobile/scripts/source-maps";

const COMPOSE_HOOK = path.join(
  import.meta.dirname,
  "../apps/mobile/scripts/compose-source-maps.mjs"
);

const DEBUG_ID = "276fc392-115d-4d38-8b2d-efc090cf44ac";

interface MapFields {
  readonly sources?: readonly string[];
  readonly debugId?: string;
  readonly chunkId?: string;
  readonly x_hermes_function_offsets?: Readonly<
    Record<string, readonly number[]>
  >;
}

const map = (fields: MapFields) =>
  JSON.stringify({
    version: 3,
    sources: ["/apps/mobile/src/diagnostics/fatal-sentinel.ts"],
    mappings: "",
    ...fields,
  });

const packagerMap = map({ debugId: DEBUG_ID });
// SDK 58's packager output has sections instead of top-level sources. The identity
// belongs to the whole map; IDs on embedded maps must never replace it.
const indexedPackagerMap = JSON.stringify({
  version: 3,
  debugId: DEBUG_ID,
  sections: [
    {
      offset: { line: 0, column: 0 },
      map: {
        version: 3,
        sources: [
          "/repo/apps/mobile/src/index.ts",
          "/repo/node_modules/react/index.js",
        ],
        names: [],
        mappings: "AAAA",
      },
    },
    {
      offset: { line: 1, column: 0 },
      map: {
        version: 3,
        debugId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ["/repo/apps/mobile/src/diagnostics/fatal-sentinel.ts"],
              names: [],
              mappings: "AAAA",
            },
          },
        ],
      },
    },
  ],
});

const composedMap = map({ x_hermes_function_offsets: { 0: [0] } });
const bytecode = new TextEncoder().encode(`\u0000hbc\u0000${DEBUG_ID}\u0000`);

/** What `compose-source-maps.mjs` records for these files. */
const provenanceOf = ({
  packager = packagerMap,
  composed = composedMap,
  shipped = bytecode,
  cloned = null,
}: {
  packager?: string;
  composed?: string;
  shipped?: Uint8Array;
  cloned?: string | null;
} = {}) =>
  JSON.stringify({
    version: 1,
    debugId: summarizeSourceMap(packager)?.debugId ?? null,
    packagerMapSha256: sha256(packager),
    compilerMapSha256: sha256("hermes"),
    composedMapSha256: sha256(composed),
    bytecodeSha256: sha256(shipped),
    clonedMapSha256: cloned === null ? null : sha256(cloned),
  });

const releaseMaps = (overrides: Partial<ReleaseMaps> = {}): ReleaseMaps => ({
  packagerMap,
  composedMap,
  provenance: provenanceOf(),
  bytecode,
  cloned: false,
  ...overrides,
});

describe(summarizeSourceMap, () => {
  it("reads Expo's debugId and PostHog's chunkId", () => {
    expect([
      summarizeSourceMap(packagerMap)?.debugId,
      summarizeSourceMap(map({ chunkId: DEBUG_ID }))?.debugId,
      summarizeSourceMap("not json"),
    ]).toStrictEqual([DEBUG_ID, DEBUG_ID, null]);
  });

  it("reads indexed and nested sections while keeping the top-level identity", () => {
    expect(summarizeSourceMap(indexedPackagerMap)).toStrictEqual({
      debugId: DEBUG_ID,
      appSources: 2,
      hermes: false,
    });
  });
});

describe(releaseMapProblems, () => {
  it("accepts maps that belong to the shipped bytecode", () => {
    expect(releaseMapProblems(releaseMaps())).toStrictEqual([]);
  });

  it("verifies an indexed packager map without relaxing bundle or provenance checks", () => {
    const indexed = releaseMaps({
      packagerMap: indexedPackagerMap,
      provenance: provenanceOf({ packager: indexedPackagerMap }),
    });
    expect([
      releaseMapProblems(indexed),
      releaseMapProblems({
        ...indexed,
        bytecode: new TextEncoder().encode("wrong bundle"),
      }),
      releaseMapProblems({ ...indexed, provenance: provenanceOf() }),
    ]).toStrictEqual([
      [],
      [
        `The shipped bundle does not contain debug ID ${DEBUG_ID}; the maps belong to another build.`,
        "The shipped bundle is not the bytecode these maps were composed for.",
      ],
      [
        "The packager map is not the one this composition kept; the maps come from different runs.",
      ],
    ]);
  });

  it("rejects URL-only indexed sections whose source contents cannot be verified", () => {
    const packager = JSON.stringify({
      version: 3,
      debugId: DEBUG_ID,
      sections: [{ offset: { line: 0, column: 0 }, url: "missing.map" }],
    });
    expect(
      releaseMapProblems(
        releaseMaps({
          packagerMap: packager,
          provenance: provenanceOf({ packager }),
        })
      )
    ).toStrictEqual([
      "The packager map has no debug ID; is metro.config.ts using getPostHogExpoConfig?",
    ]);
  });

  it("rejects maps from another build", () => {
    expect(
      releaseMapProblems(
        releaseMaps({ bytecode: new TextEncoder().encode("other build") })
      )
    ).toStrictEqual([
      `The shipped bundle does not contain debug ID ${DEBUG_ID}; the maps belong to another build.`,
      "The shipped bundle is not the bytecode these maps were composed for.",
    ]);
  });

  it("rejects a packager map without a debug ID", () => {
    const packager = map({});
    expect(
      releaseMapProblems(
        releaseMaps({
          packagerMap: packager,
          provenance: provenanceOf({ packager }),
        })
      )
    ).toStrictEqual([
      "The packager map has no debug ID; is metro.config.ts using getPostHogExpoConfig?",
    ]);
  });

  it("rejects maps with no provenance, however well their IDs agree", () => {
    expect(releaseMapProblems(releaseMaps({ provenance: null }))).toStrictEqual(
      [
        "The maps have no readable provenance.json from compose-source-maps.mjs, so nothing ties them to this bundle.",
      ]
    );
  });

  it("rejects an unrelated composed map before it is cloned, even one naming no or another chunk ID", () => {
    const stale = map({
      sources: ["/apps/mobile/src/other.ts"],
      x_hermes_function_offsets: { 0: [999_999] },
    });
    const foreign = map({
      chunkId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      x_hermes_function_offsets: { 0: [0] },
    });
    expect([
      releaseMapProblems(releaseMaps({ composedMap: stale })),
      releaseMapProblems(
        releaseMaps({
          composedMap: foreign,
          provenance: provenanceOf({ composed: foreign }),
        })
      ),
    ]).toStrictEqual([
      [
        "The composed map is not the one this composition wrote; it belongs to another run.",
      ],
      [
        "The composed map's chunk ID does not match the packager map's debug ID.",
      ],
    ]);
  });

  it("after cloning, requires the map upload cloned, carrying the chunk ID", () => {
    const clonedMap = map({
      chunkId: DEBUG_ID,
      x_hermes_function_offsets: { 0: [0] },
    });
    expect([
      releaseMapProblems(
        releaseMaps({
          composedMap: clonedMap,
          provenance: provenanceOf({ cloned: clonedMap }),
          cloned: true,
        })
      ),
      releaseMapProblems(releaseMaps({ cloned: true })),
    ]).toStrictEqual([
      [],
      [
        "The composed map's chunk ID does not match the packager map's debug ID.",
        "The composed map is not the one `upload` cloned after checking it.",
      ],
    ]);
  });

  it("rejects a composed map that is not Hermes's or names no app sources", () => {
    const composed = map({ sources: ["/node_modules/x.js"] });
    expect(
      releaseMapProblems(
        releaseMaps({
          composedMap: composed,
          provenance: provenanceOf({ composed }),
        })
      )
    ).toHaveLength(2);
  });
});

/**
 * One run of the composition hook the archive uses, on real files: a packager map with `debugId`,
 * Hermes's map, and the bytecode beside it, as react-native-xcode.sh lays them out.
 */
const composeRun = (debugId: string, offset: number, indexed = false) => {
  const work = mkdtempSync(path.join(tmpdir(), "pcob-maps-"));
  const maps = path.join(work, "maps");
  const packager = path.join(work, "packager-output.map");
  const hbc = path.join(work, "main.jsbundle");
  const sectionMap = {
    version: 3,
    sources: ["/repo/apps/mobile/src/index.ts"],
    names: [],
    mappings: "AAAA",
  };
  const packagerContents = indexed
    ? {
        version: 3,
        sections: [{ offset: { line: 0, column: 0 }, map: sectionMap }],
        debugId,
      }
    : { ...sectionMap, debugId };
  writeFileSync(packager, JSON.stringify(packagerContents));
  writeFileSync(hbc, `\u0000hbc\u0000${debugId}\u0000${offset}`);
  writeFileSync(
    `${hbc}.map`,
    JSON.stringify({
      version: 3,
      sources: ["main.jsbundle"],
      names: [],
      mappings: "AAAA",
      x_hermes_function_offsets: { 0: [offset] },
    })
  );
  const { composed } = mapsIn(maps);
  mkdirSync(path.dirname(composed), { recursive: true });
  execFileSync(
    process.execPath,
    [COMPOSE_HOOK, packager, `${hbc}.map`, "-o", composed],
    {
      stdio: "ignore",
      env: {
        ...process.env,
        PCOB_PACKAGER_SOURCEMAP_COPY: mapsIn(maps).packager,
      },
    }
  );
  return { maps, bundle: hbc };
};

const OTHER_DEBUG_ID = "9a3e6d70-5b6c-4f27-8d4c-2d6f0b1c3e4a";

describe("maps from two composition runs", () => {
  it("composes SDK 58 indexed packager output with its recorded identity intact", () => {
    const run = composeRun(DEBUG_ID, 1, true);
    expect({
      summary: summarizeSourceMap(
        readFileSync(mapsIn(run.maps).packager, "utf-8")
      ),
      problems: directoryMapProblems(run.maps, run.bundle, false),
    }).toStrictEqual({
      summary: { debugId: DEBUG_ID, appSources: 1, hermes: false },
      problems: [],
    });
  });

  it("are accepted only together with their own bundle", () => {
    const first = composeRun(DEBUG_ID, 1);
    const second = composeRun(OTHER_DEBUG_ID, 2);
    // The first run's packager map and provenance beside the second run's composed map.
    const mixed = mkdtempSync(path.join(tmpdir(), "pcob-mixed-"));
    for (const name of [
      "packager/main.jsbundle.map",
      "packager/provenance.json",
    ]) {
      mkdirSync(path.dirname(path.join(mixed, name)), { recursive: true });
      copyFileSync(path.join(first.maps, name), path.join(mixed, name));
    }
    mkdirSync(path.join(mixed, "hermes"), { recursive: true });
    copyFileSync(mapsIn(second.maps).composed, mapsIn(mixed).composed);
    expect([
      directoryMapProblems(first.maps, first.bundle, false),
      directoryMapProblems(second.maps, second.bundle, false),
      directoryMapProblems(mixed, first.bundle, false),
      directoryMapProblems(first.maps, second.bundle, false),
    ]).toStrictEqual([
      [],
      [],
      [
        "The composed map is not the one this composition wrote; it belongs to another run.",
      ],
      [
        `The shipped bundle does not contain debug ID ${DEBUG_ID}; the maps belong to another build.`,
        "The shipped bundle is not the bytecode these maps were composed for.",
      ],
    ]);
  });

  it("are accepted after cloning only once upload recorded the clone it checked", () => {
    const run = composeRun(DEBUG_ID, 1);
    const { composed } = mapsIn(run.maps);
    // What `posthog-cli hermes clone` does: copy the debug ID into the composed map.
    const clone = () => {
      const text = readFileSync(composed, "utf-8");
      writeFileSync(
        composed,
        JSON.stringify({ ...JSON.parse(text), chunkId: DEBUG_ID })
      );
    };
    clone();
    const unrecorded = directoryMapProblems(run.maps, run.bundle, true);
    recordClonedMap(run.maps);
    expect([
      unrecorded,
      directoryMapProblems(run.maps, run.bundle, true),
    ]).toStrictEqual([
      ["The composed map is not the one `upload` cloned after checking it."],
      [],
    ]);
  });
});

describe(bundleDebugId, () => {
  it("reads the trailer Expo writes", () => {
    expect(
      bundleDebugId(
        `__r(0);\n//# sourceMappingURL=main.jsbundle.map\n//# debugId=${DEBUG_ID}\n`
      )
    ).toBe(DEBUG_ID);
  });
});

/** A miniature Metro bundle: module 0 is the entry, importing `order` in sequence. */
type ModuleName = "sentinel" | "polyfill" | "diagnostics" | "router";

const bundle = (order: readonly ModuleName[]) => {
  const bodies = {
    sentinel: 'Object.defineProperty(exports, "installFatalSentinel", {});',
    polyfill: "Array.prototype.toSorted = 1;",
    diagnostics: 'const file = "pcobooster-pending-fatals-a.json";',
    router: "registerRootComponent();",
  };
  const modules = order.map(
    (name, index) =>
      `__d(function (global, require) {\n${bodies[name]}\n},${index + 1},[]);`
  );
  const entry = `__d(function (global, require) {\nrequire(0);\n},0,[${order.map((_, index) => index + 1).join(",")}]);`;
  return [
    entry,
    ...modules,
    "__r(460);",
    "__r(0);",
    "//# sourceMappingURL=main.jsbundle.map",
  ].join("\n");
};

describe(entryOrderProblems, () => {
  it("accepts the sentinel first and diagnostics before the router", () => {
    expect(
      entryOrderProblems(
        bundle(["sentinel", "polyfill", "diagnostics", "router"])
      )
    ).toStrictEqual([]);
  });

  it("rejects anything evaluated before the sentinel, or the router before diagnostics", () => {
    expect(
      entryOrderProblems(
        bundle(["polyfill", "sentinel", "router", "diagnostics"])
      )
    ).toStrictEqual([
      "The fatal sentinel is not the entry module's first import.",
      "Diagnostics is not imported before the router entry.",
    ]);
  });
});
