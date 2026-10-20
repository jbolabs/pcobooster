import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { describe, expect, it, onTestFinished } from "vitest";

import {
  sourceState,
  stampArtifact,
  treeSha256,
  verifyArtifact,
  verifySmokeEvidence,
} from "../apps/mobile/scripts/release/artifact-provenance";

const temporary = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pcob-artifacts-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};
const git = (repo: string, ...args: string[]) => {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf-8" });
  expect(result.status).toBe(0);
};
const fixture = () => {
  const repo = temporary();
  writeFileSync(path.join(repo, "source.ts"), "export const value = 1;\n");
  writeFileSync(
    path.join(repo, ".gitignore"),
    "apps/mobile/build\nnode_modules\n"
  );
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "initial"
  );
  const app = path.join(repo, "apps/mobile/build/app");
  mkdirSync(app, { recursive: true });
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, 0x1f_19_03_c1_03_bc_1f_c6n, true);
  view.setUint32(8, 98, true);
  writeFileSync(path.join(app, "main.jsbundle"), bytes);
  writeFileSync(path.join(app, "PCOBooster"), "native executable");
  writeFileSync(path.join(app, "Info.plist"), "app identity");
  return { repo, app };
};

describe("release artifact provenance", () => {
  it("rejects a dirty app stamp after source is reverted at the same HEAD", () => {
    const { repo, app } = fixture();
    const clean = sourceState(repo);
    writeFileSync(path.join(repo, "source.ts"), "export const value = 2;\n");
    const dirty = sourceState(repo);
    const stamp = stampArtifact("release-smoke-app", dirty, dirty, app);
    git(repo, "checkout", "--", "source.ts");
    expect(sourceState(repo)).toStrictEqual(clean);
    expect(() => {
      verifyArtifact(stamp, clean, app, "release-smoke-app");
    }).toThrow("Source changed");
  });

  it("refuses changed tracked or untracked source during a build", () => {
    const { repo, app } = fixture();
    const before = sourceState(repo);
    writeFileSync(path.join(repo, "untracked.ts"), "one");
    expect(() =>
      stampArtifact("release-smoke-app", before, sourceState(repo), app)
    ).toThrow("Source changed");
    const dirty = sourceState(repo);
    writeFileSync(path.join(repo, "untracked.ts"), "two");
    expect(() =>
      stampArtifact("release-smoke-app", dirty, sourceState(repo), app)
    ).toThrow("Source changed");
  });

  it.each(["PCOBooster", "Info.plist", "main.jsbundle"])(
    "rejects a changed %s in an otherwise identical app",
    (file) => {
      const { repo, app } = fixture();
      const source = sourceState(repo);
      const stamp = stampArtifact("release-smoke-app", source, source, app);
      verifyArtifact(stamp, source, app, "release-smoke-app");
      writeFileSync(path.join(app, file), "modified");
      expect(() => {
        verifyArtifact(stamp, source, app, "release-smoke-app");
      }).toThrow("app changed");
    }
  );

  it("validates a sealed smoke manifest, app, and every path's evidence", () => {
    const { repo, app } = fixture();
    const source = sourceState(repo);
    const stamp = stampArtifact("release-smoke-app", source, source, app);
    const out = temporary();
    const names = [
      "fresh-install",
      "signed-out-offline",
      "sign-in",
      "restored-session",
      "restored-offline",
    ];
    for (const name of names) {
      mkdirSync(path.join(out, name));
      for (const file of [
        "device.log",
        "launch.txt",
        "maestro.txt",
        "final.png",
      ]) {
        writeFileSync(path.join(out, name, file), "captured evidence");
      }
    }
    const manifest = {
      kind: "simulator-release-smoke",
      revision: source.revision,
      dirty: source.dirty,
      buildStamp: stamp,
      app: {
        mainJsbundleSha256: stamp.bundleSha256,
        appSha256: stamp.appSha256,
      },
      status: "PASS",
      paths: names.map((name) => ({ name, status: "PASS" })),
    };
    writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest));
    const digest = treeSha256(out);
    verifySmokeEvidence(out, digest, source, app);
    writeFileSync(
      path.join(out, "manifest.json"),
      JSON.stringify({ ...manifest, revision: "other" })
    );
    expect(() => {
      verifySmokeEvidence(out, digest, source, app);
    }).toThrow("changed since");
    expect(() => {
      verifySmokeEvidence(out, treeSha256(out), source, app);
    }).toThrow("does not describe");
  });

  it("a clean smoke reuse reaches the shared simulator boot under set -e", () => {
    const { repo } = fixture();
    const mobile = path.join(repo, "apps/mobile");
    const scripts = path.join(mobile, "scripts");
    mkdirSync(scripts, { recursive: true });
    const original = path.resolve(import.meta.dirname, "../apps/mobile");
    cpSync(
      path.join(original, "scripts/release-smoke.sh"),
      path.join(scripts, "release-smoke.sh")
    );
    cpSync(
      path.join(original, "scripts/release"),
      path.join(scripts, "release"),
      { recursive: true }
    );
    cpSync(
      path.join(original, "scripts/simulator"),
      path.join(scripts, "simulator"),
      { recursive: true }
    );
    symlinkSync(
      path.join(original, "node_modules"),
      path.join(mobile, "node_modules")
    );
    git(repo, "add", "-A");
    git(
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "smoke script"
    );
    const app = path.join(
      mobile,
      "build/derived/Build/Products/Release-iphonesimulator/PCOBooster.app"
    );
    mkdirSync(app, { recursive: true });
    cpSync(path.join(mobile, "build/app"), app, { recursive: true });
    const source = sourceState(repo);
    const stamp = stampArtifact("release-smoke-app", source, source, app);
    mkdirSync(path.join(mobile, "build/release-smoke"));
    writeFileSync(
      path.join(mobile, "build/release-smoke/build.json"),
      JSON.stringify(stamp)
    );
    const bin = temporary();
    writeFileSync(
      path.join(bin, "xcrun"),
      '#!/bin/sh\ncase "$*" in\n "simctl list devices available -j") echo \'{"devices":{"runtime":[{"name":"agent-sim-1","udid":"fixture","state":"Shutdown"}]}}\';;\n "simctl boot fixture") echo BOOT_REACHED >&2; exit 1;;\n *) exit 0;;\nesac\n',
      { mode: 0o755 }
    );
    const result = spawnSync("bash", [path.join(scripts, "release-smoke.sh")], {
      encoding: "utf-8",
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: process.env.HOME ?? "",
        MAESTRO_BIN: "/usr/bin/true",
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BOOT_REACHED");
    expect(
      readFileSync(path.join(mobile, "build/release-smoke/build.json"), "utf-8")
    ).toContain('"dirty":false');
  });
});
