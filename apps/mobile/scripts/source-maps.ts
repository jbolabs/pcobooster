/**
 * Hermes source maps for PostHog error tracking: checks that a release's maps match the bundle it
 * shipped, uploads them, and rehearses the whole pipeline locally without Xcode.
 *
 *   bun run scripts/source-maps.ts verify --maps <dir> --bundle <PCOBooster.app/main.jsbundle> [--cloned]
 *   bun run scripts/source-maps.ts upload --maps <dir> --bundle <PCOBooster.app/main.jsbundle>
 *   bun run scripts/source-maps.ts rehearse --out <dir>
 *
 * `<dir>` holds `packager/main.jsbundle.map` and `packager/provenance.json` (kept and written by
 * `compose-source-maps.mjs`) and `hermes/main.jsbundle.map` (React Native's composed map,
 * `SOURCEMAP_FILE`). See docs/mobile-diagnostics.md for how the release script wires them.
 *
 * Maps are tied to the shipped bundle by `provenance.json`, not by their debug IDs alone: the
 * composition hook records the hashes of the packager map, the composed map, and the bytecode it
 * composed them for. `verify` refuses maps whose files or archived bundle differ from it, and
 * `upload` runs that check before `hermes clone` copies the debug ID into the composed map, so a
 * stale or unrelated composed map is never given this bundle's identity.
 *
 * `upload` runs the pinned `posthog-cli` (`POSTHOG_CLI`, else `posthog-cli` on PATH) with
 * `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` from the environment. It never reads them
 * from a file and never prints them.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

import { Option, Schema } from "effect";

export const POSTHOG_CLI_VERSION = "0.18.9";
const POSTHOG_HOST = "https://us.posthog.com";
const DEBUG_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;
const BUNDLE_DEBUG_ID = /\/\/# debugId=(?<id>[\da-f-]{36})\s*$/u;
const MAIN_MODULE = /__r\((?<id>\d+)\);\s*\/\/# sourceMappingURL=/u;
const SENTINEL_MARKER = 'Object.defineProperty(exports, "installFatalSentinel"';
const DIAGNOSTICS_MARKER = "pcobooster-pending-fatals-a.json";
const APP_SOURCE = "apps/mobile/src/";

interface SourceMapMetadata {
  readonly debugId?: string;
  readonly chunkId?: string;
  readonly x_hermes_function_offsets?: Schema.Json;
}

type SourceMap = SourceMapMetadata &
  (
    | { readonly sources: readonly string[] }
    | {
        readonly sections: readonly {
          readonly offset: { readonly line: number; readonly column: number };
          readonly map: SourceMap;
        }[];
      }
  );

const mapMetadata = {
  debugId: Schema.optionalKey(Schema.String),
  chunkId: Schema.optionalKey(Schema.String),
  x_hermes_function_offsets: Schema.optionalKey(Schema.Json),
};

// Expo 58 emits indexed maps. Each embedded section may itself be indexed; URL-only
// sections cannot establish which sources were archived, so they remain unsupported.
const SourceMapSchema: Schema.Codec<SourceMap> = Schema.suspend(() =>
  Schema.Union([
    Schema.Struct({ sources: Schema.Array(Schema.String), ...mapMetadata }),
    Schema.Struct({
      sections: Schema.Array(
        Schema.Struct({
          offset: Schema.Struct({ line: Schema.Number, column: Schema.Number }),
          map: SourceMapSchema,
        })
      ),
      ...mapMetadata,
    }),
  ])
);

const decodeMap = Schema.decodeUnknownOption(
  Schema.fromJsonString(SourceMapSchema)
);

const appSourceCount = (map: SourceMap): number =>
  "sources" in map
    ? map.sources.filter((source) => source.includes(APP_SOURCE)).length
    : map.sections.reduce(
        (count, section) => count + appSourceCount(section.map),
        0
      );

const Sha256 = Schema.String.check(Schema.isPattern(/^[\da-f]{64}$/u));

const ProvenanceSchema = Schema.Struct({
  version: Schema.Literal(1),
  debugId: Schema.NullOr(Schema.String),
  packagerMapSha256: Sha256,
  compilerMapSha256: Sha256,
  composedMapSha256: Sha256,
  bytecodeSha256: Schema.NullOr(Sha256),
  clonedMapSha256: Schema.NullOr(Sha256),
});
/** What `compose-source-maps.mjs` recorded about one composition run. */
export type Provenance = typeof ProvenanceSchema.Type;
const decodeProvenance = Schema.decodeUnknownOption(
  Schema.fromJsonString(ProvenanceSchema)
);

export const sha256 = (contents: string | Uint8Array): string =>
  createHash("sha256").update(contents).digest("hex");

export interface SourceMapSummary {
  /** The debug ID the map names (`debugId`, or PostHog's `chunkId` after `hermes clone`). */
  readonly debugId: string | null;
  readonly appSources: number;
  readonly hermes: boolean;
}

/** What a source map says about itself, or null when it is not a source map. */
export const summarizeSourceMap = (text: string): SourceMapSummary | null => {
  const decoded = decodeMap(text);
  if (Option.isNone(decoded)) {
    return null;
  }
  const map = decoded.value;
  const debugId = map.chunkId ?? map.debugId ?? null;
  return {
    debugId: debugId !== null && DEBUG_ID.test(debugId) ? debugId : null,
    appSources: appSourceCount(map),
    hermes: map.x_hermes_function_offsets !== undefined,
  };
};

/** The debug ID a JavaScript bundle ends with (`//# debugId=`), or null. */
export const bundleDebugId = (bundle: string): string | null =>
  BUNDLE_DEBUG_ID.exec(bundle)?.groups?.id ?? null;

export interface ReleaseMaps {
  readonly packagerMap: string;
  readonly composedMap: string;
  /** `provenance.json`, or null when there is none. */
  readonly provenance: string | null;
  /** The shipped Hermes bytecode bundle. */
  readonly bytecode: Uint8Array;
  /**
   * After `upload` ran `posthog-cli hermes clone`: the composed map must then be the one it
   * cloned and carry the debug ID. Before, it must be the one the composition wrote.
   */
  readonly cloned: boolean;
}

const provenanceProblems = (
  { packagerMap, composedMap, provenance, bytecode, cloned }: ReleaseMaps,
  debugId: string | null
): string[] => {
  const recorded =
    provenance === null ? null : Option.getOrNull(decodeProvenance(provenance));
  if (recorded === null) {
    return [
      "The maps have no readable provenance.json from compose-source-maps.mjs, so nothing ties them to this bundle.",
    ];
  }
  const problems: string[] = [];
  if (
    sha256(packagerMap) !== recorded.packagerMapSha256 ||
    recorded.debugId !== debugId
  ) {
    problems.push(
      "The packager map is not the one this composition kept; the maps come from different runs."
    );
  }
  if (
    recorded.bytecodeSha256 === null ||
    sha256(bytecode) !== recorded.bytecodeSha256
  ) {
    problems.push(
      "The shipped bundle is not the bytecode these maps were composed for."
    );
  }
  const composed = sha256(composedMap);
  if (!cloned && composed !== recorded.composedMapSha256) {
    problems.push(
      "The composed map is not the one this composition wrote; it belongs to another run."
    );
  }
  if (cloned && composed !== recorded.clonedMapSha256) {
    problems.push(
      "The composed map is not the one `upload` cloned after checking it."
    );
  }
  return problems;
};

/** Problems that would leave a release's stacks unreadable; empty when the maps match. */
export const releaseMapProblems = (maps: ReleaseMaps): string[] => {
  const { packagerMap, composedMap, bytecode, cloned } = maps;
  const problems: string[] = [];
  const packager = summarizeSourceMap(packagerMap);
  const composed = summarizeSourceMap(composedMap);
  if (packager === null || packager.debugId === null) {
    problems.push(
      "The packager map has no debug ID; is metro.config.ts using getPostHogExpoConfig?"
    );
  }
  if (composed === null) {
    problems.push("The composed Hermes map is missing or unreadable.");
  } else {
    if (!composed.hermes) {
      problems.push(
        "The composed map has no Hermes function offsets; it is not React Native's composed map."
      );
    }
    if (composed.appSources === 0) {
      problems.push(`The composed map names no ${APP_SOURCE} sources.`);
    }
    // Before cloning, a composed map naming any ID names another bundle's.
    const mismatched = cloned
      ? composed.debugId === null || composed.debugId !== packager?.debugId
      : composed.debugId !== null && composed.debugId !== packager?.debugId;
    if (mismatched) {
      problems.push(
        "The composed map's chunk ID does not match the packager map's debug ID."
      );
    }
  }
  const debugId = packager?.debugId;
  if (
    debugId !== null &&
    debugId !== undefined &&
    !Buffer.from(bytecode).includes(debugId)
  ) {
    problems.push(
      `The shipped bundle does not contain debug ID ${debugId}; the maps belong to another build.`
    );
  }
  return [...problems, ...provenanceProblems(maps, packager?.debugId ?? null)];
};

const moduleBody = (bundle: string, id: string): string | null => {
  const end = bundle.indexOf(`},${id},[`);
  if (end === -1) {
    return null;
  }
  const start = bundle.lastIndexOf("__d(function", end);
  const depsEnd = bundle.indexOf("]", end);
  return start === -1 ? null : bundle.slice(start, depsEnd + 1);
};

const moduleDependencies = (body: string): string[] => {
  const list = body.slice(body.lastIndexOf("[") + 1, -1);
  return list === "" ? [] : list.split(",");
};

/**
 * Problems with the order the entry module (`index.ts`) evaluates in a built bundle: the
 * dependency-free sentinel first, diagnostics before the router.
 */
export const entryOrderProblems = (bundle: string): string[] => {
  const main = MAIN_MODULE.exec(bundle)?.groups?.id;
  const entry = main === undefined ? null : moduleBody(bundle, main);
  if (entry === null) {
    return ["The bundle's entry module was not found."];
  }
  const dependencies = moduleDependencies(entry);
  const bodies = dependencies.map((id) => moduleBody(bundle, id) ?? "");
  const sentinel = bodies.findIndex((body) => body.includes(SENTINEL_MARKER));
  const diagnostics = bodies.findIndex((body) =>
    body.includes(DIAGNOSTICS_MARKER)
  );
  const problems: string[] = [];
  if (sentinel !== 0) {
    problems.push("The fatal sentinel is not the entry module's first import.");
  }
  if (
    sentinel !== -1 &&
    moduleDependencies(bodies[sentinel] ?? "").length > 0
  ) {
    problems.push("The fatal sentinel module has dependencies.");
  }
  // The router entry is the last import; diagnostics must evaluate before it.
  if (diagnostics === -1 || diagnostics >= dependencies.length - 1) {
    problems.push("Diagnostics is not imported before the router entry.");
  }
  return problems;
};

const option = (args: readonly string[], name: string): string => {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing ${name} <path>.`);
  }
  return path.resolve(value);
};

export const mapsIn = (directory: string) => ({
  packager: path.join(directory, "packager", "main.jsbundle.map"),
  provenance: path.join(directory, "packager", "provenance.json"),
  composed: path.join(directory, "hermes", "main.jsbundle.map"),
});

const readIfPresent = (file: string): string | null =>
  existsSync(file) ? readFileSync(file, "utf-8") : null;

/** `releaseMapProblems` for the maps in `directory` and the bundle at `bundle`. */
export const directoryMapProblems = (
  directory: string,
  bundle: string,
  cloned: boolean
): string[] => {
  const maps = mapsIn(directory);
  return releaseMapProblems({
    packagerMap: readIfPresent(maps.packager) ?? "",
    composedMap: readIfPresent(maps.composed) ?? "",
    provenance: readIfPresent(maps.provenance),
    bytecode: readFileSync(bundle),
    cloned,
  });
};

/** Records the composed map `hermes clone` just rewrote as the one `upload` checked. */
export const recordClonedMap = (directory: string) => {
  const maps = mapsIn(directory);
  const recorded = Option.getOrThrow(
    decodeProvenance(readFileSync(maps.provenance, "utf-8"))
  );
  writeFileSync(
    maps.provenance,
    `${JSON.stringify(
      { ...recorded, clonedMapSha256: sha256(readFileSync(maps.composed)) },
      null,
      2
    )}\n`
  );
};

/** Whether `upload` already cloned the composed map now in `directory`. */
const alreadyCloned = (directory: string): boolean => {
  const maps = mapsIn(directory);
  const provenance = readIfPresent(maps.provenance);
  const recorded =
    provenance === null ? null : Option.getOrNull(decodeProvenance(provenance));
  return (
    recorded?.clonedMapSha256 !== null &&
    recorded?.clonedMapSha256 === sha256(readFileSync(maps.composed))
  );
};

const fail = (problems: readonly string[]) => {
  if (problems.length > 0) {
    for (const problem of problems) {
      process.stderr.write(`error: ${problem}\n`);
    }
    process.exit(1);
  }
};

const verify = (directory: string, bundle: string, cloned: boolean) => {
  fail(directoryMapProblems(directory, bundle, cloned));
  process.stdout.write(`Source maps match ${bundle}.\n`);
};

const readSetting = Schema.decodeUnknownSync(Schema.String);

/** An environment setting, or the empty string. */
const setting = (name: string): string => readSetting(process.env[name] ?? "");

const posthogCli = (): string => {
  const cli = setting("POSTHOG_CLI") || "posthog-cli";
  const version = execFileSync(cli, ["--version"], { encoding: "utf-8" });
  if (!version.includes(POSTHOG_CLI_VERSION)) {
    throw new Error(
      `posthog-cli ${POSTHOG_CLI_VERSION} is required; found "${version.trim()}".`
    );
  }
  return cli;
};

const upload = (directory: string, bundle: string) => {
  for (const name of ["POSTHOG_CLI_API_KEY", "POSTHOG_CLI_PROJECT_ID"]) {
    if (setting(name) === "") {
      throw new Error(`${name} must be set for the upload step only.`);
    }
  }
  const cli = posthogCli();
  const maps = mapsIn(directory);
  const environment = {
    ...process.env,
    POSTHOG_CLI_HOST: setting("POSTHOG_CLI_HOST") || POSTHOG_HOST,
  };
  // Clone only maps proven to be this bundle's; a re-run after a failed upload skips the clone.
  if (!alreadyCloned(directory)) {
    verify(directory, bundle, false);
    // Each event names its release ($app_namespace, $app_version, $app_build), so the maps are
    // uploaded release-independent and matched by chunk ID.
    execFileSync(
      cli,
      [
        "hermes",
        "clone",
        "--minified-map-path",
        maps.packager,
        "--composed-map-path",
        maps.composed,
        "--release-mode",
        "event",
      ],
      { stdio: "inherit", env: environment }
    );
    recordClonedMap(directory);
  }
  verify(directory, bundle, true);
  execFileSync(
    cli,
    [
      "hermes",
      "upload",
      "--directory",
      path.dirname(maps.composed),
      "--release-mode",
      "event",
    ],
    { stdio: "inherit", env: environment }
  );
};

/**
 * The release pipeline without Xcode: Metro's release bundle with PostHog's serializer, Hermes
 * bytecode from React Native's own compiler package, composition through the same hook the
 * archive uses, then `verify` and the entry-order check against the result.
 */
const rehearse = (out: string) => {
  const mobile = path.join(import.meta.dirname, "..");
  const requireFromApp = createRequire(path.join(mobile, "package.json"));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const bundle = path.join(out, "main.jsbundle");
  const packagerMap = path.join(out, "packager-output.map");
  const maps = mapsIn(path.join(out, "maps"));
  execFileSync(
    "bunx",
    [
      "expo",
      "export:embed",
      "--platform",
      "ios",
      "--dev",
      "false",
      "--minify",
      "false",
      "--reset-cache",
      "--entry-file",
      "index.ts",
      "--bundle-output",
      bundle,
      "--sourcemap-output",
      packagerMap,
      "--assets-dest",
      path.join(out, "assets"),
    ],
    {
      cwd: mobile,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    }
  );
  // React Native's own Hermes compiler package, as its Xcode script would use.
  const requireFromReactNative = createRequire(
    requireFromApp.resolve("react-native/package.json")
  );
  const hermesc = path.join(
    path.dirname(
      requireFromReactNative.resolve("hermes-compiler/package.json")
    ),
    "hermesc",
    process.platform === "darwin" ? "osx-bin" : "linux64-bin",
    "hermesc"
  );
  const bytecode = path.join(out, "main.hbc");
  execFileSync(hermesc, [
    "-emit-binary",
    "-max-diagnostic-width=80",
    "-O",
    "-output-source-map",
    "-out",
    bytecode,
    bundle,
  ]);
  mkdirSync(path.dirname(maps.composed), { recursive: true });
  execFileSync(
    process.execPath,
    [
      path.join(import.meta.dirname, "compose-source-maps.mjs"),
      packagerMap,
      `${bytecode}.map`,
      "-o",
      maps.composed,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, PCOB_PACKAGER_SOURCEMAP_COPY: maps.packager },
    }
  );
  fail(entryOrderProblems(readFileSync(bundle, "utf-8")));
  verify(path.join(out, "maps"), bytecode, false);
  process.stdout.write(
    `Rehearsal passed: bundle ${bundleDebugId(readFileSync(bundle, "utf-8"))}, maps in ${path.join(out, "maps")}.\n`
  );
};

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "verify": {
      verify(
        option(args, "--maps"),
        option(args, "--bundle"),
        args.includes("--cloned")
      );
      break;
    }
    case "upload": {
      upload(option(args, "--maps"), option(args, "--bundle"));
      break;
    }
    case "rehearse": {
      rehearse(option(args, "--out"));
      break;
    }
    default: {
      throw new Error(
        "Usage: source-maps.ts verify --maps <dir> --bundle <main.jsbundle> [--cloned] | upload --maps <dir> --bundle <main.jsbundle> | rehearse --out <dir>"
      );
    }
  }
}
