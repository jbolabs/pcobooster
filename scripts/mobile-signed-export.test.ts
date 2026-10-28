import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  sourceState,
  stampArtifact,
  treeSha256,
} from "../apps/mobile/scripts/release/artifact-provenance";
import {
  assertUnchanged,
  parseSignature,
  releasePaths,
  verifySignedExport,
} from "../apps/mobile/scripts/release/signed-export";
import type {
  CommandResult,
  RunCommand,
  SignedExportInput,
} from "../apps/mobile/scripts/release/signed-export";
import { sha256 } from "../apps/mobile/scripts/source-maps";

const TEAM = "6C46GY4Z38";
const BUNDLE = "com.pcobooster.ios";
const DEBUG_ID = "276fc392-115d-4d38-8b2d-efc090cf44ac";
const MAIN_UUID = "0A1B2C3D-0000-4000-8000-000000000001";
const HERMES_UUID = "0A1B2C3D-0000-4000-8000-000000000002";
const DISTRIBUTION = [
  "Authority=Apple Distribution: Bodega Labs (6C46GY4Z38)",
  "Authority=Apple Worldwide Developer Relations Certification Authority",
  "Authority=Apple Root CA",
];

const temporary = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pcob-export-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

const write = (file: string, contents: string | Uint8Array) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
};

interface MapFields {
  readonly debugId?: string;
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

interface Entitlements {
  readonly "application-identifier": string;
  readonly "com.apple.developer.team-identifier": string;
  readonly "get-task-allow": boolean;
}

interface Profile {
  readonly TeamIdentifier: readonly string[];
  readonly Entitlements: { readonly "application-identifier": string };
  readonly ProvisionedDevices?: readonly string[];
}

/** What the fake `codesign` and `security` report; tests change it to break the signature. */
interface Signing {
  authorities: readonly string[];
  team: string;
  identifier: string;
  entitlements: Entitlements;
  profile: Profile;
}

const ok = (stdout: string, stderr = ""): CommandResult => ({
  status: 0,
  stdout,
  stderr,
});
const NO_KEY: CommandResult = { status: 1, stdout: "", stderr: "no such key" };
const decodePlist = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
);
const decodeString = Schema.decodeUnknownSync(Schema.String);

/** `plutil -extract <key> json|raw`, over the JSON plists these fixtures write. */
const extract = (args: readonly string[], input: string | undefined) => {
  const last = args.at(-1) ?? "";
  const plist = decodePlist(
    last === "-" ? (input ?? "") : readFileSync(last, "utf-8")
  );
  const value = plist[args[1] ?? ""];
  if (value === undefined) {
    return NO_KEY;
  }
  return ok(args[2] === "raw" ? decodeString(value) : JSON.stringify(value));
};

const codesign = (signing: Signing, args: readonly string[]) => {
  if (args[0] === "--verify") {
    return ok("");
  }
  if (args.includes("--entitlements")) {
    return ok(JSON.stringify(signing.entitlements));
  }
  return ok(
    "",
    [
      `Identifier=${signing.identifier}`,
      ...signing.authorities,
      `TeamIdentifier=${signing.team}`,
    ].join("\n")
  );
};

const dwarfdump = (args: readonly string[]) => {
  const last = args.at(-1) ?? "";
  const dsym = path.join(last, "uuid");
  const file = existsSync(dsym) ? dsym : last;
  return ok(`UUID: ${readFileSync(file, "utf-8")} (arm64) ${last}\n`);
};

const distribution = (): Signing => ({
  authorities: DISTRIBUTION,
  team: TEAM,
  identifier: BUNDLE,
  entitlements: {
    "application-identifier": `${TEAM}.${BUNDLE}`,
    "com.apple.developer.team-identifier": TEAM,
    "get-task-allow": false,
  },
  profile: {
    TeamIdentifier: [TEAM],
    Entitlements: { "application-identifier": `${TEAM}.${BUNDLE}` },
  },
});

/**
 * A committed checkout with an archived release, its signed IPA's contents, maps, dSYMs, and gate
 * evidence, all under ignored build folders. Plists are JSON so a fake `plutil` can read them.
 */
const fixture = () => {
  const repo = temporary();
  const git = (...args: string[]) =>
    spawnSync("git", ["-C", repo, ...args], { encoding: "utf-8" });
  write(path.join(repo, "source.ts"), "export const value = 1;\n");
  write(
    path.join(repo, ".gitignore"),
    "apps/mobile/build\napps/mobile/.captures\n"
  );
  git("init", "-q");
  git("add", "-A");
  git(
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@example.com",
    "commit",
    "-qm",
    "init"
  );
  const source = sourceState(repo);
  const mobile = path.join(repo, "apps/mobile");
  const out = path.join(mobile, "build/release");
  const paths = releasePaths(out);
  const bytecode = Buffer.from(`\u0000hbc\u0000${DEBUG_ID}\u0000`);
  const info = (version: string) =>
    JSON.stringify({
      CFBundleIdentifier: BUNDLE,
      CFBundleShortVersionString: "0.1.0",
      CFBundleVersion: version,
      CFBundleExecutable: "PCOBooster",
    });
  write(path.join(paths.app, "main.jsbundle"), bytecode);
  write(path.join(paths.app, "PCOBooster"), MAIN_UUID);
  write(path.join(paths.app, "Info.plist"), info("373"));
  const hermes = path.join(paths.app, "Frameworks/hermesvm.framework");
  write(path.join(hermes, "hermesvm"), HERMES_UUID);
  write(
    path.join(hermes, "Info.plist"),
    JSON.stringify({ CFBundleExecutable: "hermesvm" })
  );
  writeFileSync(
    paths.stamp,
    JSON.stringify(
      stampArtifact("release-archive-app", source, source, paths.app)
    )
  );
  write(path.join(paths.dsyms, "PCOBooster.app.dSYM/uuid"), MAIN_UUID);
  write(path.join(paths.dsyms, "hermesvm.framework.dSYM/uuid"), HERMES_UUID);

  const packager = map({ debugId: DEBUG_ID });
  const composed = map({ x_hermes_function_offsets: { 0: [0] } });
  write(path.join(paths.maps, "packager/main.jsbundle.map"), packager);
  write(path.join(paths.maps, "hermes/main.jsbundle.map"), composed);
  write(
    path.join(paths.maps, "packager/provenance.json"),
    JSON.stringify({
      version: 1,
      debugId: DEBUG_ID,
      packagerMapSha256: sha256(packager),
      compilerMapSha256: sha256("hermes"),
      composedMapSha256: sha256(composed),
      bytecodeSha256: sha256(bytecode),
      clonedMapSha256: null,
    })
  );

  // What the IPA unpacks to: the archived app, signed, plus Apple's symbol files.
  const ipaContents = path.join(repo, "apps/mobile/build/ipa-contents");
  const signed = path.join(ipaContents, "Payload/PCOBooster.app");
  cpSync(paths.app, signed, { recursive: true });
  write(path.join(signed, "embedded.mobileprovision"), "profile");
  write(path.join(signed, "_CodeSignature/CodeResources"), "signature");
  write(path.join(ipaContents, `Symbols/${MAIN_UUID}.symbols`), "symbols");
  write(path.join(ipaContents, `Symbols/${HERMES_UUID}.symbols`), "symbols");
  write(path.join(paths.export, "PCOBooster.ipa"), "zipped ipa bytes");

  const hermesEvidence = path.join(
    mobile,
    `build/hermes-gate/runs/${source.revision}/evidence.json`
  );
  const evidence = {
    kind: "host-hermes-probe",
    revision: source.revision,
    dirty: false,
    status: "PASS",
    archivedBundle: { sha256: sha256(bytecode), problems: [] },
  };
  write(hermesEvidence, JSON.stringify(evidence));

  const smokeApp = path.join(
    mobile,
    "build/derived/Build/Products/Release-iphonesimulator/PCOBooster.app"
  );
  write(path.join(smokeApp, "main.jsbundle"), "smoke bytecode");
  const smokeStamp = stampArtifact(
    "release-smoke-app",
    source,
    source,
    smokeApp
  );
  const smokeDir = path.join(
    mobile,
    `.captures/release-smoke/${source.revision}`
  );
  const names = [
    "fresh-install",
    "signed-out-offline",
    "sign-in",
    "restored-session",
    "restored-offline",
  ];
  for (const name of names) {
    for (const file of [
      "device.log",
      "launch.txt",
      "maestro.txt",
      "final.png",
    ]) {
      write(path.join(smokeDir, name, file), "captured");
    }
  }
  write(
    path.join(smokeDir, "manifest.json"),
    JSON.stringify({
      kind: "simulator-release-smoke",
      revision: source.revision,
      dirty: false,
      buildStamp: smokeStamp,
      app: {
        mainJsbundleSha256: smokeStamp.bundleSha256,
        appSha256: smokeStamp.appSha256,
      },
      status: "PASS",
      paths: names.map((name) => ({ name, status: "PASS" })),
    })
  );
  writeFileSync(`${smokeDir}.sha256`, `${treeSha256(smokeDir)}\n`);

  const signing = distribution();
  const unpacked: string[] = [];
  const run: RunCommand = (command, args, input) => {
    const last = args.at(-1) ?? "";
    switch (command) {
      case "ditto": {
        unpacked.push(last);
        cpSync(ipaContents, last, { recursive: true });
        return ok("");
      }
      case "plutil": {
        if (args[0] === "-extract") {
          return extract(args, input);
        }
        return ok(last === "-" ? (input ?? "") : readFileSync(last, "utf-8"));
      }
      case "codesign": {
        return codesign(signing, args);
      }
      case "security": {
        return ok(JSON.stringify(signing.profile));
      }
      case "dwarfdump": {
        return dwarfdump(args);
      }
      default: {
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      }
    }
  };
  const input: SignedExportInput = {
    repo,
    out,
    expected: {
      bundleId: BUNDLE,
      version: "0.1.0",
      build: 373,
      teamId: TEAM,
      sourceSha: source.revision,
    },
    hermesEvidence,
    smoke: { dir: smokeDir, app: smokeApp },
    frameworksWithoutDsyms: [],
    run,
  };
  return {
    input,
    paths,
    signing,
    ipaContents,
    signed,
    unpacked,
    info,
    hermesEvidence,
    evidence,
  };
};

// Real CLI launches and throwaway checkouts need headroom on shared CI runners.
describe("the signed export gate", { timeout: 30_000 }, () => {
  it("binds a matching distribution IPA to its archive, symbols, maps, and evidence", () => {
    const { input, paths, unpacked } = fixture();
    const identity = verifySignedExport(input);
    expect(identity).toMatchObject({
      build: 373,
      bundleSha256: sha256(readFileSync(path.join(paths.app, "main.jsbundle"))),
      ipaSha256: sha256("zipped ipa bytes"),
      signing: { teamId: TEAM },
      dsyms: [
        {
          binary: "PCOBooster",
          uuid: MAIN_UUID,
          archived: true,
          inIpaSymbols: true,
        },
        {
          binary: "Frameworks/hermesvm.framework/hermesvm",
          uuid: HERMES_UUID,
          archived: true,
          inIpaSymbols: true,
        },
      ],
    });
    expect(identity.manifestSha256).toBe(sha256(readFileSync(paths.manifest)));
    // The unpacked IPA is always removed.
    expect(unpacked).toHaveLength(1);
    expect(existsSync(unpacked[0] ?? "")).toBeFalsy();
  });

  it("detects an IPA re-exported after verification", () => {
    const { input, paths } = fixture();
    const identity = verifySignedExport(input);
    expect(() => {
      assertUnchanged(input.out, identity);
    }).not.toThrow();
    writeFileSync(path.join(paths.export, "PCOBooster.ipa"), "re-exported");
    expect(() => {
      assertUnchanged(input.out, identity);
    }).toThrow("changed since verification");
  });

  it("removes the unpacked IPA even when a check fails", () => {
    const { input, signing, unpacked } = fixture();
    signing.team = "OTHERTEAM1";
    expect(() => verifySignedExport(input)).toThrow("by team OTHERTEAM1");
    expect(existsSync(unpacked[0] ?? "")).toBeFalsy();
  });

  it.each([
    {
      name: "a development signature",
      change: (signing: Signing) => {
        signing.authorities = [
          "Authority=Apple Development: Someone",
          "Authority=Apple Root CA",
        ];
      },
      expected: "not an Apple distribution certificate",
    },
    {
      name: "debuggable entitlements",
      change: (signing: Signing) => {
        signing.entitlements = {
          ...signing.entitlements,
          "get-task-allow": true,
        };
      },
      expected: "not a distribution signature",
    },
    {
      name: "a device-limited profile",
      change: (signing: Signing) => {
        signing.profile = {
          ...signing.profile,
          ProvisionedDevices: ["00008110-01"],
        };
      },
      expected: "not an App Store profile",
    },
    {
      name: "another app's signature",
      change: (signing: Signing) => {
        signing.identifier = "com.example.other";
      },
      expected: "signed as com.example.other",
    },
  ])("refuses $name", ({ change, expected }) => {
    const { input, signing } = fixture();
    change(signing);
    expect(() => verifySignedExport(input)).toThrow(expected);
  });

  it("refuses an IPA whose bytecode, identity, or build is not the archive's", () => {
    const bytecode = fixture();
    writeFileSync(
      path.join(bytecode.signed, "main.jsbundle"),
      "other bytecode"
    );
    expect(() => verifySignedExport(bytecode.input)).toThrow(
      "not the archived bundle"
    );
    const build = fixture();
    writeFileSync(path.join(build.signed, "Info.plist"), build.info("374"));
    expect(() => verifySignedExport(build.input)).toThrow("(374), not");
  });

  it("refuses maps for other bytecode and Hermes evidence for another bundle", () => {
    const maps = fixture();
    writeFileSync(
      path.join(maps.paths.maps, "hermes/main.jsbundle.map"),
      map({ x_hermes_function_offsets: { 0: [1] } })
    );
    expect(() => verifySignedExport(maps.input)).toThrow(
      "Source maps do not match"
    );
    const hermes = fixture();
    writeFileSync(
      hermes.hermesEvidence,
      JSON.stringify({
        ...hermes.evidence,
        archivedBundle: { sha256: "0".repeat(64), problems: [] },
      })
    );
    expect(() => verifySignedExport(hermes.input)).toThrow(
      "Hermes gate evidence"
    );
  });

  it("requires archived dSYMs and IPA symbols for every executable unless a framework is reviewed", () => {
    const missing = fixture();
    rmSync(path.join(missing.paths.dsyms, "hermesvm.framework.dSYM"), {
      recursive: true,
    });
    rmSync(path.join(missing.ipaContents, `Symbols/${HERMES_UUID}.symbols`));
    expect(() => verifySignedExport(missing.input)).toThrow(
      "lacks an archived dSYM and symbols in the IPA"
    );
    expect(() =>
      verifySignedExport({
        ...missing.input,
        frameworksWithoutDsyms: ["hermesvm.framework"],
      })
    ).not.toThrow();
    const main = fixture();
    rmSync(path.join(main.ipaContents, `Symbols/${MAIN_UUID}.symbols`));
    expect(() =>
      verifySignedExport({
        ...main.input,
        frameworksWithoutDsyms: ["PCOBooster"],
      })
    ).toThrow(
      "PCOBooster (0A1B2C3D-0000-4000-8000-000000000001) lacks symbols in the IPA"
    );
  });

  it("refuses a checkout that is not the clean dispatched revision, or stale smoke evidence", () => {
    const dirty = fixture();
    writeFileSync(path.join(dirty.input.repo, "source.ts"), "changed");
    expect(() => verifySignedExport(dirty.input)).toThrow("dirty at");
    const other = fixture();
    expect(() =>
      verifySignedExport({
        ...other.input,
        expected: { ...other.input.expected, sourceSha: "b".repeat(40) },
      })
    ).toThrow("not the dispatched");
    const smoke = fixture();
    writeFileSync(
      path.join(smoke.input.smoke.dir, "sign-in/device.log"),
      "edited"
    );
    expect(() => verifySignedExport(smoke.input)).toThrow(
      "changed since it was sealed"
    );
  });

  it("parses codesign's signing identity", () => {
    expect(
      parseSignature(
        [
          "Identifier=com.pcobooster.ios",
          ...DISTRIBUTION,
          `TeamIdentifier=${TEAM}`,
        ].join("\n")
      )
    ).toStrictEqual({
      identifier: BUNDLE,
      teamId: TEAM,
      authority: "Apple Distribution: Bodega Labs (6C46GY4Z38)",
    });
    expect(() => parseSignature("Identifier=x")).toThrow("no identifier");
  });
});
