/**
 * The Release Hermes gate: proves the production contracts and the typed product client load in
 * the exact Hermes engine the app ships, from the bytecode a Release build produces.
 *
 * Usage: bun run scripts/hermes-gate/gate.ts [--bundle <main.jsbundle>]
 *
 * 1. Resolves the Hermes version React Native's podspec installs, and the matching release
 *    tarball from Maven Central (CocoaPods' shared cache first), checked against Maven's SHA-1.
 * 2. Compiles `runner.cpp` against that tarball's macOS hermesvm framework.
 * 3. Bundles `probe.ts` with Expo's `export:embed` (the Release build's bundling command, with
 *    the app's own Metro configuration, transform profile, and polyfills) and compiles it with
 *    the tarball's hermesc and the flags React Native's Xcode phase passes for Release.
 * 4. Runs the current source, which must pass and reflect exactly the route table Node sees,
 *    and the build 371 route parser, which must fail with build 371's fatal.
 *
 * `--bundle` also checks an archived app's `main.jsbundle` is bytecode of the same version.
 * Evidence lands in `build/hermes-gate/runs/<revision>`. This is host-engine evidence: it does
 * not start React Native, UIKit, or native modules (see `scripts/release-smoke.sh`).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

import { makeProductClient } from "@pcobooster/client/product-client";
import { procedureRoutes } from "@pcobooster/contracts/http/api";

import {
  archiveBundleProblems,
  hbcVersion,
  hermesVersionFromPodfileLock,
  hermesVersionFromProperties,
  parseHermescVersion,
  passingProbeProblems,
  regressionProbeProblems,
  withOldRouteParser,
} from "./gate-checks";
import type { Expected, ProbeRun } from "./gate-checks";

const mobile = path.resolve(import.meta.dirname, "../..");
const repo = path.resolve(mobile, "../..");
const gateDir = path.join(mobile, "scripts/hermes-gate");
const work = path.join(mobile, "build/hermes-gate");
const MAVEN = "https://repo1.maven.org/maven2/com/facebook/hermes/hermes-ios";
/** React Native's Xcode phase compiles Release bundles with exactly these flags. */
const HERMESC_RELEASE_FLAGS = [
  "-emit-binary",
  "-max-diagnostic-width=80",
  "-O",
];

const run = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    discardStdout?: boolean;
  } = {}
): ProbeRun => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? mobile,
    env: options.env ?? process.env,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: [
      "ignore",
      options.discardStdout === true ? "ignore" : "pipe",
      "pipe",
    ],
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error?.message ?? ""}`,
  };
};

const must = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
): string => {
  const result = run(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout;
};

const sha = (algorithm: "sha1" | "sha256", file: string): string =>
  createHash(algorithm).update(readFileSync(file)).digest("hex");

const resolveFrom = (specifier: string, from: string): string =>
  must("node", [
    "--print",
    `require.resolve(${JSON.stringify(specifier)}, { paths: [require.resolve(${JSON.stringify(from)})] })`,
  ]).trim();

/** Maven's SHA-1 for the tarball, or null when Maven cannot be reached. */
const mavenSha1 = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(`${url}.sha1`);
    const body = await response.text();
    const text = body.trim().toLowerCase();
    return response.ok && /^[0-9a-f]{40}$/u.test(text) ? text : null;
  } catch {
    return null;
  }
};

/** The shipped engine's release tarball, extracted once per version, and how it was verified. */
const prepareEngine = async (version: string) => {
  const name = `hermes-ios-${version}-release.tar.gz`;
  const url = `${MAVEN}/${version}/hermes-ios-${version}-hermes-ios-release.tar.gz`;
  const cache = path.join(homedir(), "Library/Caches/ReactNative");
  const tarball = path.join(cache, name);
  const engine = path.join(work, "engine", version);
  const recorded = path.join(engine, "tarball.sha1");
  const expected = await mavenSha1(url);
  if (!existsSync(tarball)) {
    if (expected === null) {
      throw new Error(
        `Cannot reach Maven Central for ${url}.sha1 to download the engine`
      );
    }
    console.log(`==> Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Downloading ${url} failed: ${response.status}`);
    }
    mkdirSync(cache, { recursive: true });
    writeFileSync(
      `${tarball}.download`,
      new Uint8Array(await response.arrayBuffer())
    );
    must("mv", [`${tarball}.download`, tarball]);
  }
  const actual = sha("sha1", tarball);
  const previous = existsSync(recorded)
    ? readFileSync(recorded, "utf-8").trim()
    : null;
  let verifiedBy: string;
  if (expected !== null) {
    if (actual !== expected) {
      throw new Error(
        `${tarball} SHA-1 ${actual} does not match Maven's ${expected}`
      );
    }
    verifiedBy = "maven-sha1";
  } else if (previous === actual) {
    verifiedBy = "previous-maven-verified-run";
  } else {
    throw new Error(
      "Maven Central is unreachable and this tarball was never verified"
    );
  }
  if (previous !== actual) {
    rmSync(engine, { recursive: true, force: true });
    mkdirSync(engine, { recursive: true });
    must("tar", [
      "-xzf",
      tarball,
      "-C",
      engine,
      "destroot/bin/hermesc",
      "destroot/include",
      "destroot/Library/Frameworks/macosx",
    ]);
    writeFileSync(recorded, `${actual}\n`);
  }
  return {
    url,
    tarball,
    sha1: actual,
    verifiedBy,
    hermesc: path.join(engine, "destroot/bin/hermesc"),
    include: path.join(engine, "destroot/include"),
    frameworks: path.join(engine, "destroot/Library/Frameworks/macosx"),
    engine,
  };
};

type Engine = Awaited<ReturnType<typeof prepareEngine>>;

/** The runner, rebuilt when its source or the engine changes. */
const prepareRunner = (engine: Engine): string => {
  const source = path.join(gateDir, "runner.cpp");
  const runner = path.join(engine.engine, "runner");
  const stamp = path.join(engine.engine, "runner.stamp");
  const key = `${sha("sha256", source)} ${engine.sha1}`;
  if (
    !existsSync(runner) ||
    !existsSync(stamp) ||
    readFileSync(stamp, "utf-8") !== key
  ) {
    must("xcrun", [
      "clang++",
      "-std=c++20",
      "-O1",
      "-I",
      engine.include,
      "-F",
      engine.frameworks,
      "-framework",
      "hermesvm",
      `-Wl,-rpath,${engine.frameworks}`,
      source,
      "-o",
      runner,
    ]);
    writeFileSync(stamp, key);
  }
  return runner;
};

/** Bundles the probe as a Release build bundles the app, then compiles it to bytecode. */
const buildProbe = (
  label: string,
  engine: Engine,
  out: string,
  substitute: string | null
) => {
  const cli = resolveFrom("@expo/cli", "expo/package.json");
  const bundle = path.join(out, `${label}.js`);
  const bytecode = path.join(out, `${label}.hbc`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    // Release archives never read dotenv files either (`release-ios.sh`).
    EXPO_NO_DOTENV: "1",
  };
  delete env.EXPO_OVERRIDE_METRO_CONFIG;
  if (substitute !== null) {
    env.EXPO_OVERRIDE_METRO_CONFIG = path.join(
      gateDir,
      "regression.metro.config.ts"
    );
    env.PCOB_HERMES_GATE_SUBSTITUTE = substitute;
  }
  must(
    "node",
    [
      cli,
      "export:embed",
      "--entry-file",
      path.join(gateDir, "probe.ts"),
      "--platform",
      "ios",
      "--dev",
      "false",
      "--minify",
      "false",
      "--reset-cache",
      "--bundle-output",
      bundle,
      "--sourcemap-output",
      `${bundle}.map`,
      "--assets-dest",
      path.join(out, `${label}-assets`),
    ],
    { env }
  );
  must(engine.hermesc, [...HERMESC_RELEASE_FLAGS, "-out", bytecode, bundle]);
  return { bundle, bytecode, sha256: sha("sha256", bytecode) };
};

const OLD_PATH_PARAM = /:(?<name>[A-Za-z]+)/gu;
const SERVICE_PLANS_PATH = "/service-types/:serviceTypeId/plans";

/**
 * The names the old parser finds in V8 (Node, which runs Vitest) and JavaScriptCore (Bun, which
 * runs this gate). Both see `serviceTypeId`, which is why only a Hermes check caught build 371.
 */
const hostControls = () => ({
  node: must("node", [
    "--print",
    `JSON.stringify([...${JSON.stringify(SERVICE_PLANS_PATH)}.matchAll(${OLD_PATH_PARAM.toString()})].map((match) => match.groups?.name ?? ""))`,
  ]).trim(),
  bun: JSON.stringify(
    [...SERVICE_PLANS_PATH.matchAll(OLD_PATH_PARAM)].map(
      (match) => match.groups?.name ?? ""
    )
  ),
});

const main = async () => {
  const argv = process.argv.slice(2);
  const bundleIndex = argv.indexOf("--bundle");
  const appBundle = bundleIndex === -1 ? null : argv[bundleIndex + 1];
  if (bundleIndex !== -1 && appBundle === undefined) {
    throw new Error("--bundle needs the path of an app's main.jsbundle");
  }

  const reactNative = path.dirname(
    resolveFrom("react-native/package.json", "expo/package.json")
  );
  const version = hermesVersionFromProperties(
    readFileSync(
      path.join(reactNative, "sdks/hermes-engine/version.properties"),
      "utf-8"
    )
  );
  const podfileLock = path.join(mobile, "ios/Podfile.lock");
  const podVersion = existsSync(podfileLock)
    ? hermesVersionFromPodfileLock(readFileSync(podfileLock, "utf-8"))
    : null;
  if (podVersion !== null && podVersion !== version) {
    throw new Error(
      `ios/Podfile.lock pins hermes-engine ${podVersion}, not ${version}`
    );
  }

  const revision = must("git", ["-C", repo, "rev-parse", "HEAD"]).trim();
  const dirty =
    must("git", ["-C", repo, "status", "--porcelain"]).trim() !== "";
  const out = path.join(work, "runs", dirty ? `${revision}-dirty` : revision);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const engine = await prepareEngine(version);
  const compiler = parseHermescVersion(must(engine.hermesc, ["-version"]));
  if (compiler.version !== version) {
    throw new Error(`hermesc reports ${compiler.version}, not ${version}`);
  }
  const runner = prepareRunner(engine);

  const client = makeProductClient({
    url: "https://probe.invalid",
    client: "expo",
  });
  const expected: Expected = {
    hermesVersion: version,
    bytecodeVersion: compiler.bytecodeVersion,
    groups: Object.keys(client.api),
    routes: procedureRoutes.map((route) => ({
      tag: route.tag,
      method: route.method,
      path: route.path,
      params: route.params,
    })),
  };

  const endpoint = path.join(repo, "packages/contracts/src/http/endpoint.ts");
  const regressionSource = path.join(out, "regression/endpoint.ts");
  mkdirSync(path.dirname(regressionSource), { recursive: true });
  writeFileSync(
    regressionSource,
    withOldRouteParser(readFileSync(endpoint, "utf-8"))
  );

  const scenarios = [
    { label: "current", substitute: null, expectation: "loads" },
    {
      label: "old-route-parser",
      substitute: `${endpoint}=${regressionSource}`,
      expectation: "fails with build 371's fatal",
    },
  ] as const;
  const results = scenarios.map(({ label, substitute, expectation }) => {
    console.log(
      `==> ${label}: bundling with export:embed and hermesc ${HERMESC_RELEASE_FLAGS.join(" ")}`
    );
    const probe = buildProbe(label, engine, out, substitute);
    const result = run(runner, [probe.bytecode]);
    writeFileSync(path.join(out, `${label}.stdout`), result.stdout);
    writeFileSync(path.join(out, `${label}.stderr`), result.stderr);
    // The bundles and bytecode are tens of MB; their hashes stay in the evidence.
    for (const artifact of [
      probe.bundle,
      `${probe.bundle}.map`,
      probe.bytecode,
      path.join(out, `${label}-assets`),
    ]) {
      rmSync(artifact, { recursive: true, force: true });
    }
    const problems =
      label === "current"
        ? passingProbeProblems(result, expected)
        : regressionProbeProblems(result);
    console.log(
      problems.length === 0
        ? `PASS ${label} ${expectation}`
        : `FAIL ${label} should have ${expectation}\n  ${problems.join("\n  ")}`
    );
    return {
      label,
      bytecodeSha256: probe.sha256,
      exitCode: result.exitCode,
      problems,
    };
  });

  let archivedBundle: {
    path: string;
    bytecodeVersion: number | null;
    sha256: string;
    integrityExitCode: number;
    runtimeExecuted: false;
    validatedBy: string;
    problems: string[];
  } | null = null;
  if (appBundle !== null && appBundle !== undefined) {
    const bytes = readFileSync(appBundle);
    const found = hbcVersion(bytes);
    // -b treats input as bytecode. Discard the enormous dump, but retain diagnostics and status.
    // This validates the whole artifact without claiming React Native/native startup ran here.
    const inspection = run(
      engine.hermesc,
      ["-b", "-dump-bytecode", appBundle],
      { discardStdout: true }
    );
    archivedBundle = {
      path: appBundle,
      bytecodeVersion: found,
      sha256: sha("sha256", appBundle),
      integrityExitCode: inspection.exitCode,
      runtimeExecuted: false,
      validatedBy: "matching-hermesc-bytecode-reader",
      problems: archiveBundleProblems(
        bytes,
        compiler.bytecodeVersion,
        inspection
      ),
    };
    console.log(
      archivedBundle.problems.length === 0
        ? `PASS archived bundle parsed as HBC${found} (integrity only; app runtime not executed)`
        : `FAIL ${archivedBundle.problems.join("; ")}`
    );
  }

  const failed =
    results.some((result) => result.problems.length > 0) ||
    (archivedBundle?.problems.length ?? 0) > 0;
  const evidence = {
    kind: "host-hermes-probe",
    limits:
      "Host macOS hermesvm from the shipped release tarball. Covers module load and API/client construction from Release bytecode; not React Native, UIKit, native modules, routing, or a device.",
    revision,
    dirty,
    createdAt: new Date().toISOString(),
    hermes: {
      version,
      bytecodeVersion: compiler.bytecodeVersion,
      podfileLockVersion: podVersion,
      tarballUrl: engine.url,
      tarballSha1: engine.sha1,
      verifiedBy: engine.verifiedBy,
      hermescFlags: HERMESC_RELEASE_FLAGS,
    },
    bundler:
      "expo export:embed --platform ios --dev false --minify false --reset-cache",
    oldParserOnHostEngines: hostControls(),
    results,
    archivedBundle,
    status: failed ? "FAIL" : "PASS",
  };
  writeFileSync(
    path.join(out, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`
  );
  console.log(
    `==> Evidence: ${path.relative(repo, path.join(out, "evidence.json"))}`
  );
  if (failed) {
    process.exitCode = 1;
  }
};

await main();
