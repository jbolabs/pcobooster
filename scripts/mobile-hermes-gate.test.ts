import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  archiveBundleProblems,
  hbcVersion,
  hermesVersionFromPodfileLock,
  hermesVersionFromProperties,
  OLD_ROUTE_PARSER_FATAL,
  parseHermescVersion,
  passingProbeProblems,
  regressionProbeProblems,
  withOldRouteParser,
} from "../apps/mobile/scripts/hermes-gate/gate-checks";
import type { Expected } from "../apps/mobile/scripts/hermes-gate/gate-checks";

const endpointSource = readFileSync(
  path.join(import.meta.dirname, "../packages/contracts/src/http/endpoint.ts"),
  "utf-8"
);

const route = {
  tag: "catalog.plans",
  method: "GET",
  path: "/api/v1/service-types/:serviceTypeId/plans",
  params: ["serviceTypeId"],
};

const expected: Expected = {
  hermesVersion: "250829098.0.17",
  bytecodeVersion: 98,
  groups: ["health", "catalog"],
  routes: [route],
};

const runtime = {
  "OSS Release Version": "250829098.0.17",
  "Bytecode Version": 98,
  Build: "Release",
};

interface ReportOverrides {
  readonly groups?: readonly string[];
  readonly routes?: readonly (typeof route)[];
  readonly runtime?: Readonly<Record<keyof typeof runtime, string | number>>;
}

const report = (overrides: ReportOverrides = {}): string =>
  JSON.stringify({
    status: "PASS",
    api: "pcobooster",
    wireApi: "pcobooster",
    groups: ["health", "catalog"],
    routes: [route],
    runtime,
    ...overrides,
  });

describe("the build 371 route parser regression", () => {
  it("puts the named-group matchAll parser back into the current endpoint source", () => {
    const old = withOldRouteParser(endpointSource);
    expect(old).toContain(
      '[...path.matchAll(PATH_PARAM)].map((match) => match.groups?.name ?? "")'
    );
    expect(old).toContain("const PATH_PARAM = /:(?<name>[A-Za-z]+)/gu;");
    expect(old).not.toContain('.split("/")');
  });

  it("fails loudly once the current parser moves, rather than testing nothing", () => {
    expect(() => withOldRouteParser("const unrelated = 1;")).toThrow(
      "Release Hermes gate's regression"
    );
  });

  it("requires the original fatal, not just any failure", () => {
    expect(
      regressionProbeProblems({
        exitCode: 1,
        stdout: "",
        stderr: `${OLD_ROUTE_PARSER_FATAL}\n\nError: ${OLD_ROUTE_PARSER_FATAL}`,
      })
    ).toStrictEqual([]);
    expect(
      regressionProbeProblems({
        exitCode: 1,
        stdout: "",
        stderr: "ReferenceError: x",
      })
    ).toStrictEqual(["failed differently from build 371: ReferenceError: x"]);
    expect(
      regressionProbeProblems({ exitCode: 0, stdout: report(), stderr: "" })
    ).toHaveLength(1);
  });
});

describe("a passing probe", () => {
  it("passes when Hermes reflects the routes and client groups Node sees", () => {
    expect(
      passingProbeProblems(
        { exitCode: 0, stdout: `${report()}\n`, stderr: "" },
        expected
      )
    ).toStrictEqual([]);
  });

  it("fails on a module-load exception", () => {
    expect(
      passingProbeProblems(
        { exitCode: 1, stdout: "", stderr: "Error: boom\n" },
        expected
      )
    ).toStrictEqual(["exited 1: Error: boom"]);
  });

  it("fails when a route lost its params under Hermes without throwing", () => {
    const problems = passingProbeProblems(
      {
        exitCode: 0,
        stdout: report({ routes: [{ ...route, params: [""] }] }),
        stderr: "",
      },
      expected
    );
    expect(problems).toStrictEqual([
      "Hermes lacks route GET /api/v1/service-types/:serviceTypeId/plans [serviceTypeId]",
      "Hermes has unexpected route GET /api/v1/service-types/:serviceTypeId/plans []",
    ]);
  });

  it("fails on a different engine, bytecode version, or a Debug engine", () => {
    const problems = passingProbeProblems(
      {
        exitCode: 0,
        stdout: report({
          runtime: {
            "OSS Release Version": "0.17.0",
            "Bytecode Version": 96,
            Build: "Debug",
          },
        }),
        stderr: "",
      },
      expected
    );
    expect(problems).toStrictEqual([
      "ran on Hermes 0.17.0",
      "ran bytecode version 96",
      "ran a Debug engine",
    ]);
  });

  it("fails when the client lacks a group or the report is not JSON", () => {
    expect(
      passingProbeProblems(
        { exitCode: 0, stdout: report({ groups: ["health"] }), stderr: "" },
        expected
      )
    ).toStrictEqual(["client groups [health]"]);
    expect(
      passingProbeProblems({ exitCode: 0, stdout: "ok", stderr: "" }, expected)
    ).toStrictEqual(["printed no report: ok"]);
  });
});

describe("the shipped engine", () => {
  it("rejects a matching header when the full bytecode reader rejects the file", () => {
    const header = new Uint8Array(12);
    const view = new DataView(header.buffer);
    view.setBigUint64(0, 0x1f_19_03_c1_03_bc_1f_c6n, true);
    view.setUint32(8, 98, true);
    expect(hbcVersion(header)).toBe(98);
    expect(
      archiveBundleProblems(header, 98, {
        exitCode: 1,
        stdout: "",
        stderr: "File too small",
      })
    ).toStrictEqual([
      "Archived bytecode failed the matching Hermes reader: File too small",
    ]);
    expect(
      archiveBundleProblems(new Uint8Array(), 98, {
        exitCode: 1,
        stdout: "",
        stderr: "Invalid bytecode",
      })
    ).toHaveLength(2);
  });

  it("reads the Hermes version React Native's podspec installs", () => {
    // React Native 0.88's sdks/hermes-engine/version.properties.
    expect(
      hermesVersionFromProperties("HERMES_VERSION_NAME=260318099.0.4\n")
    ).toBe("260318099.0.4");
    expect(() =>
      hermesVersionFromProperties("HERMES_V1_VERSION_NAME=250829098.0.17\n")
    ).toThrow("HERMES_VERSION_NAME");
  });

  it("reads hermesc's release and bytecode versions", () => {
    expect(
      parseHermescVersion(
        "Hermes JavaScript compiler.\n  Hermes release version: 250829098.0.17\n  HBC bytecode version: 98\n"
      )
    ).toStrictEqual({ version: "250829098.0.17", bytecodeVersion: 98 });
    expect(() => parseHermescVersion("LLVM")).toThrow("hermesc -version");
  });

  it("reads the hermes-engine version a Podfile.lock pinned", () => {
    const lock =
      "PODS:\n  - hermes-engine (250829098.0.17):\n    - hermes-engine/Pre-built (= 250829098.0.17)\n";
    expect(hermesVersionFromPodfileLock(lock)).toBe("250829098.0.17");
    expect(hermesVersionFromPodfileLock("PODS:\n")).toBeNull();
  });

  it("reads the bytecode version of a Hermes bundle and rejects plain JavaScript", () => {
    const bytecode = new Uint8Array(16);
    const view = new DataView(bytecode.buffer);
    view.setBigUint64(0, 0x1f_19_03_c1_03_bc_1f_c6n, true);
    view.setUint32(8, 98, true);
    expect(hbcVersion(bytecode)).toBe(98);
    expect(
      hbcVersion(new TextEncoder().encode("var __BUNDLE_START_TIME__=1;"))
    ).toBeNull();
    expect(hbcVersion(new Uint8Array(4))).toBeNull();
  });
});
