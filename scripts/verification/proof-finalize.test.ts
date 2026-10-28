import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { fixtureGit, validationFixture, writeFixture } from "../ci/fixtures";
import { finalizeProof } from "./proof";
import {
  deriveVerdict,
  proofReceiptSchema,
  renderProofReport,
  sha256,
} from "./proof-core";
import type { ProofReceipt } from "./proof-core";

const capturedProof = (failed = false) => {
  const cwd = validationFixture();
  writeFixture(cwd, ".git/info/exclude", ".artifacts/\n");
  const base = fixtureGit(cwd, "rev-parse", "HEAD");
  fixtureGit(cwd, "checkout", "-b", "task");
  writeFixture(cwd, ".github/workflows/ci.yml", "name: example\n");
  fixtureGit(cwd, "add", ".");
  fixtureGit(
    cwd,
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=ci@example.com",
    "commit",
    "-m",
    "Change CI"
  );
  const diff = execFileSync("git", ["diff", "--binary", `${base}...HEAD`], {
    cwd,
  });
  const patchId =
    execFileSync("git", ["patch-id", "--stable"], {
      cwd,
      input: diff,
      encoding: "utf-8",
    })
      .trim()
      .split(/\s+/u)[0] ?? "";
  const command = (name: string, invocation: string, exitCode = 0) => {
    const logPath = `logs/${name}.log`;
    const log = Buffer.from(`Captured ${name}: exit ${exitCode}\n`);
    writeFixture(cwd, `.artifacts/proof/${logPath}`, log.toString());
    return {
      name,
      command: invocation,
      exitCode,
      durationMs: 42,
      logPath,
      sha256: sha256(log),
      status: exitCode === 0 ? ("pass" as const) : ("fail" as const),
    };
  };
  const receipt: ProofReceipt = {
    artifacts: [],
    base: { ref: "main", sha: base },
    changedFiles: [".github/workflows/ci.yml"],
    commands: [
      command("ci", "bun run ci"),
      command("build", "bun run build", failed ? 1 : 0),
    ],
    createdAt: "2026-10-28T12:00:00.000Z",
    flows: [],
    focusedChecks: [command("boundary", "bun vitest boundary")],
    headSha: fixtureGit(cwd, "rev-parse", "HEAD"),
    independentVerification: null,
    notes: [],
    patchId,
    requiresVisualEvidence: false,
    riskTier: "critical",
    rollback: "Revert this change",
    schemaVersion: 1,
    verdict: "BLOCKED",
  };
  const captured = { ...receipt, verdict: deriveVerdict(receipt) };
  const receiptPath = path.join(cwd, ".artifacts/proof/receipt.json");
  writeFixture(cwd, ".artifacts/proof/receipt.json", JSON.stringify(captured));
  writeFixture(cwd, ".artifacts/proof/report.md", renderProofReport(captured));
  return { cwd, receipt, receiptPath };
};

describe("proof finalization", () => {
  it("adds independent review to captured gates and preserves the original receipt", () => {
    const { cwd, receiptPath } = capturedProof();
    const output = finalizeProof(
      [
        "--receipt",
        receiptPath,
        "--verifier-verdict",
        "PASS",
        "--verifier-summary",
        "Boundary verified",
        "--verifier-source",
        "review-task-1",
      ],
      cwd
    );
    const receipt = Schema.decodeUnknownSync(
      Schema.fromJsonString(proofReceiptSchema)
    )(readFileSync(output, "utf-8"));
    expect({
      verdict: receipt.verdict,
      commands: receipt.commands.map((command) => [
        command.command,
        command.durationMs,
      ]),
      reviewer: receipt.independentVerification?.source,
    }).toStrictEqual({
      verdict: "PASS",
      commands: [
        ["bun run ci", 42],
        ["bun run build", 42],
      ],
      reviewer: "review-task-1",
    });
    expect(
      Schema.decodeUnknownSync(Schema.fromJsonString(proofReceiptSchema))(
        readFileSync(receiptPath, "utf-8")
      ).verdict
    ).toBe("BLOCKED");
    expect(
      readFileSync(path.join(path.dirname(output), "logs/build.log"), "utf-8")
    ).toBe("Captured build: exit 0\n");
  });

  it("rejects a failed gate", () => {
    const { cwd, receiptPath } = capturedProof(true);
    expect(() => finalizeProof(["--receipt", receiptPath], cwd)).toThrow(
      "Failed checks cannot be finalized"
    );
  });

  it.each(["log", "dirty", "head", "base"] as const)(
    "rejects changed %s evidence",
    (mutation) => {
      const { cwd, receiptPath, receipt } = capturedProof();
      if (mutation === "log") {
        writeFixture(cwd, ".artifacts/proof/logs/ci.log", "tampered\n");
      } else if (mutation === "dirty") {
        writeFixture(cwd, "untracked.ts", "export const changed = true;\n");
      } else if (mutation === "head") {
        fixtureGit(cwd, "checkout", "main");
      } else {
        fixtureGit(cwd, "update-ref", "refs/heads/main", receipt.headSha);
      }
      const expected = {
        log: "command log changed",
        dirty: "Commit or stash",
        head: "does not match current HEAD",
        base: "Proof base has changed",
      };
      expect(() => finalizeProof(["--receipt", receiptPath], cwd)).toThrow(
        expected[mutation]
      );
    }
  );
});
