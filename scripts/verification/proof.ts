import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { Schema } from "effect";

import {
  artifactKindForPath,
  classifyChangedFiles,
  deriveVerdict,
  githubAttachmentArgument,
  independentVerificationSchema,
  maxRiskTier,
  proofReceiptSchema,
  renderProofReport,
  requiresVisualEvidence,
  riskTierSchema,
  sha256,
  validateReceiptSemantics,
} from "./proof-core";
import type { ProofArtifact, ProofCommand, ProofReceipt } from "./proof-core";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const isMain = process.argv[1] === import.meta.filename;
const MAX_GIT_DIFF_BYTES = 16 * 1024 * 1024;

const fail = (message: string): never => {
  throw new Error(message);
};

const git = (args: readonly string[], cwd = repositoryRoot): string =>
  execFileSync("git", [...args], {
    cwd,
    encoding: "utf-8",
  }).trim();

const flagValues = (args: readonly string[], name: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail(`${name} requires a value`);
      }
      values.push(value);
      index += 1;
    }
  }
  return values;
};

const flagValue = (
  args: readonly string[],
  name: string,
  fallback?: string
): string =>
  flagValues(args, name).at(-1) ?? fallback ?? fail(`${name} is required`);

const optionalFlagValue = (
  args: readonly string[],
  name: string
): string | undefined => flagValues(args, name).at(-1);

const readIndependentVerification = (
  args: readonly string[]
): ProofReceipt["independentVerification"] => {
  const verdict = optionalFlagValue(args, "--verifier-verdict");
  const summary = optionalFlagValue(args, "--verifier-summary");
  const source = optionalFlagValue(args, "--verifier-source");
  const suppliedFields = [verdict, summary, source].filter(
    (value) => value !== undefined
  ).length;
  if (suppliedFields === 0) {
    return null;
  }
  if (
    suppliedFields !== 3 ||
    verdict === undefined ||
    summary === undefined ||
    source === undefined
  ) {
    fail(
      "--verifier-verdict, --verifier-summary, and --verifier-source must be provided together"
    );
  }
  return Schema.decodeUnknownSync(independentVerificationSchema)({
    source,
    summary,
    verdict,
  });
};

const runCapturedCommand = async (
  name: string,
  command: readonly string[],
  proofDirectory: string,
  logName = name,
  recordedCommand = command.join(" ")
): Promise<ProofCommand> => {
  const startedAt = performance.now();
  const child = spawn(
    command[0] ?? fail("Command must not be empty"),
    command.slice(1),
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  await once(child, "close");
  const exitCode = child.exitCode ?? 1;
  const logPath = path.join("logs", `${logName}.log`);
  const logContents = Buffer.concat(chunks);
  writeFileSync(path.join(proofDirectory, logPath), logContents);
  return {
    command: recordedCommand,
    durationMs: Math.round(performance.now() - startedAt),
    exitCode,
    logPath,
    name,
    sha256: sha256(logContents),
    status: exitCode === 0 ? "pass" : "fail",
  };
};

interface FocusedCheck {
  command: string;
  name: string;
}

const parseFocusedCheck = (value: string): FocusedCheck => {
  const separator = value.indexOf("::");
  if (separator === -1) {
    return fail("--focused-check must use the format name::command");
  }
  const name = value.slice(0, separator).trim();
  const command = value.slice(separator + 2).trim();
  if (name === "" || command === "") {
    return fail("--focused-check requires both a name and command");
  }
  return { command, name };
};

const calculatePatchId = (
  baseSha: string,
  headSha: string,
  cwd = repositoryRoot
): string => {
  const diff = execFileSync(
    "git",
    ["diff", "--binary", `${baseSha}...${headSha}`],
    {
      cwd,
      maxBuffer: MAX_GIT_DIFF_BYTES,
    }
  );
  if (diff.length === 0) {
    return fail("The proof range has no changes");
  }
  const result = execFileSync("git", ["patch-id", "--stable"], {
    cwd,
    encoding: "utf-8",
    input: diff,
  }).trim();
  return (
    result.split(/\s+/u)[0] ?? fail("Could not calculate a stable patch ID")
  );
};

const parseArtifact = (
  value: string,
  proofDirectory: string
): ProofArtifact => {
  const separator = value.lastIndexOf("#");
  const suppliedPath = separator === -1 ? value : value.slice(0, separator);
  const alt =
    separator === -1 ? path.basename(suppliedPath) : value.slice(separator + 1);
  const source = path.isAbsolute(suppliedPath)
    ? suppliedPath
    : path.resolve(repositoryRoot, suppliedPath);
  if (!existsSync(source)) {
    return fail(`Proof artifact does not exist: ${suppliedPath}`);
  }
  const contents = readFileSync(source);
  const contentHash = sha256(contents);
  const artifactDirectory = path.join(proofDirectory, "artifacts");
  mkdirSync(artifactDirectory, { recursive: true });
  const storedName = `${contentHash.slice(0, 12)}-${path.basename(source)}`;
  const destination = path.join(artifactDirectory, storedName);
  copyFileSync(source, destination);
  return {
    alt: alt || path.basename(source),
    kind: artifactKindForPath(source),
    path: path.join("artifacts", storedName),
    sha256: contentHash,
  };
};

interface LoadedReceipt {
  directory: string;
  receipt: ProofReceipt;
}

const readReceipt = (
  receiptPath: string,
  cwd = repositoryRoot
): LoadedReceipt => {
  const absolutePath = path.isAbsolute(receiptPath)
    ? receiptPath
    : path.resolve(cwd, receiptPath);
  return {
    directory: path.dirname(absolutePath),
    receipt: Schema.decodeUnknownSync(proofReceiptSchema)(
      JSON.parse(readFileSync(absolutePath, "utf-8"))
    ),
  };
};

const verifyReceipt = (
  receiptPath: string,
  cwd = repositoryRoot
): ProofReceipt => {
  const { directory, receipt } = readReceipt(receiptPath, cwd);
  const currentHead = git(["rev-parse", "HEAD"], cwd);
  if (receipt.headSha !== currentHead) {
    return fail(
      `Receipt head ${receipt.headSha} does not match current HEAD ${currentHead}`
    );
  }
  const currentPatchId = calculatePatchId(receipt.base.sha, currentHead, cwd);
  if (receipt.patchId !== currentPatchId) {
    return fail("Receipt patch ID no longer matches the checked-out change");
  }
  const changedFiles = git(
    ["diff", "--name-only", `${receipt.base.sha}...${currentHead}`],
    cwd
  )
    .split("\n")
    .filter(Boolean);
  const semanticViolations = validateReceiptSemantics(receipt, {
    changedFiles,
    minimumRiskTier: classifyChangedFiles(changedFiles),
    requiresVisualEvidence: requiresVisualEvidence(changedFiles),
  });
  if (semanticViolations.length > 0) {
    return fail(`Receipt is inconsistent: ${semanticViolations.join("; ")}`);
  }
  for (const command of [...receipt.commands, ...receipt.focusedChecks]) {
    const logPath = path.join(directory, command.logPath);
    if (!existsSync(logPath)) {
      return fail(`Receipt command log is missing: ${command.logPath}`);
    }
    if (sha256(readFileSync(logPath)) !== command.sha256) {
      return fail(
        `Receipt command log changed after capture: ${command.logPath}`
      );
    }
  }
  for (const artifact of receipt.artifacts) {
    const artifactPath = path.join(directory, artifact.path);
    if (!existsSync(artifactPath)) {
      return fail(`Receipt artifact is missing: ${artifact.path}`);
    }
    if (sha256(readFileSync(artifactPath)) !== artifact.sha256) {
      return fail(`Receipt artifact changed after capture: ${artifact.path}`);
    }
  }
  const reportPath = path.join(directory, "report.md");
  if (!existsSync(reportPath)) {
    return fail("Proof report is missing");
  }
  if (readFileSync(reportPath, "utf-8") !== renderProofReport(receipt)) {
    return fail("Proof report does not match the verified receipt");
  }
  return receipt;
};

const assertProofRevision = (
  headSha: string,
  baseRef: string,
  baseSha: string
): void => {
  if (
    git(["status", "--porcelain"]) !== "" ||
    git(["rev-parse", "HEAD"]) !== headSha ||
    git(["rev-parse", baseRef]) !== baseSha
  ) {
    fail(
      "Checkout or base changed while proof ran; run proof again on the final revision"
    );
  }
};

const runProof = async (args: readonly string[]): Promise<void> => {
  if (git(["status", "--porcelain"]) !== "") {
    fail(
      "Commit or stash tracked changes before creating revision-bound proof"
    );
  }
  const baseRef = flagValue(args, "--base", "origin/main");
  const headSha = git(["rev-parse", "HEAD"]);
  const baseSha = git(["merge-base", baseRef, headSha]);
  const changedFiles = git(["diff", "--name-only", `${baseSha}...${headSha}`])
    .split("\n")
    .filter(Boolean);
  if (changedFiles.length === 0) {
    fail(`No changed files between ${baseRef} and HEAD`);
  }
  const requestedRisk = flagValue(args, "--risk", "auto");
  const automaticRiskTier = classifyChangedFiles(changedFiles);
  const riskTier =
    requestedRisk === "auto"
      ? automaticRiskTier
      : maxRiskTier(
          automaticRiskTier,
          Schema.decodeUnknownSync(riskTierSchema)(requestedRisk)
        );
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  const proofDirectory = path.join(
    repositoryRoot,
    ".artifacts",
    "proofs",
    `${timestamp}-${headSha.slice(0, 8)}`
  );
  mkdirSync(path.join(proofDirectory, "logs"), { recursive: true });

  const commands: ProofCommand[] = [];
  commands.push(
    await runCapturedCommand("ci", ["bun", "run", "ci"], proofDirectory)
  );
  if (
    riskTier !== "low" &&
    commands.every((command) => command.status === "pass")
  ) {
    commands.push(
      await runCapturedCommand("build", ["bun", "run", "build"], proofDirectory)
    );
  }
  const requestedFocusedChecks = flagValues(args, "--focused-check").map(
    parseFocusedCheck
  );
  const focusedChecks = commands.every((command) => command.status === "pass")
    ? await Promise.all(
        requestedFocusedChecks.map(
          async (focusedCheck, index) =>
            await runCapturedCommand(
              focusedCheck.name,
              ["/bin/sh", "-lc", focusedCheck.command],
              proofDirectory,
              `focused-${index + 1}`,
              focusedCheck.command
            )
        )
      )
    : [];
  const artifacts = flagValues(args, "--artifact").map((value) =>
    parseArtifact(value, proofDirectory)
  );
  const visualEvidenceRequired = requiresVisualEvidence(changedFiles);
  const notes = flagValues(args, "--note");
  const independentVerification = readIndependentVerification(args);
  const rollback = optionalFlagValue(args, "--rollback") ?? null;
  assertProofRevision(headSha, baseRef, baseSha);

  let receipt: ProofReceipt = {
    artifacts,
    base: { ref: baseRef, sha: baseSha },
    changedFiles,
    commands,
    createdAt: new Date().toISOString(),
    flows: flagValues(args, "--flow"),
    focusedChecks,
    headSha,
    independentVerification,
    notes,
    patchId: calculatePatchId(baseSha, headSha),
    requiresVisualEvidence: visualEvidenceRequired,
    riskTier,
    rollback,
    schemaVersion: 1,
    verdict: "BLOCKED",
  };
  receipt = { ...receipt, verdict: deriveVerdict(receipt) };
  const receiptPath = path.join(proofDirectory, "receipt.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(
    path.join(proofDirectory, "report.md"),
    renderProofReport(receipt)
  );
  process.stdout.write(`${receipt.verdict} ${receiptPath}\n`);
  if (receipt.verdict === "FAIL" || receipt.verdict === "BLOCKED") {
    process.exitCode = 1;
  }
};

/** Attach later review/media to verified gates; a failed or stale run is never reusable. */
export const finalizeProof = (
  args: readonly string[],
  cwd = repositoryRoot
): string => {
  if (git(["status", "--porcelain"], cwd) !== "") {
    return fail("Commit or stash changes before finalizing proof");
  }
  if (args.includes("--focused-check") || args.includes("--risk")) {
    return fail(
      "Finalization cannot change risk or execute checks; use proof run"
    );
  }
  const sourcePath = flagValue(args, "--receipt");
  const receipt = verifyReceipt(sourcePath, cwd);
  if (git(["rev-parse", receipt.base.ref], cwd) !== receipt.base.sha) {
    return fail("Proof base has changed; run proof again");
  }
  if (
    [...receipt.commands, ...receipt.focusedChecks].some(
      (command) => command.status !== "pass"
    )
  ) {
    return fail("Failed checks cannot be finalized; run proof again");
  }
  const { directory } = readReceipt(sourcePath, cwd);
  const output = path.join(
    directory,
    `finalized-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`
  );
  mkdirSync(output, { recursive: true });
  const capturedPaths = [
    ...[...receipt.commands, ...receipt.focusedChecks].map(
      (command) => command.logPath
    ),
    ...receipt.artifacts.map((artifact) => artifact.path),
  ];
  for (const entry of capturedPaths) {
    mkdirSync(path.dirname(path.join(output, entry)), { recursive: true });
    copyFileSync(path.join(directory, entry), path.join(output, entry));
  }
  const updated: ProofReceipt = {
    ...receipt,
    artifacts: [
      ...receipt.artifacts,
      ...flagValues(args, "--artifact").map((value) =>
        parseArtifact(value, output)
      ),
    ],
    flows: [...receipt.flows, ...flagValues(args, "--flow")],
    notes: [...receipt.notes, ...flagValues(args, "--note")],
    independentVerification:
      readIndependentVerification(args) ?? receipt.independentVerification,
    rollback: optionalFlagValue(args, "--rollback") ?? receipt.rollback,
  };
  const finalized = { ...updated, verdict: deriveVerdict(updated) };
  const receiptPath = path.join(output, "receipt.json");
  writeFileSync(receiptPath, `${JSON.stringify(finalized, null, 2)}\n`);
  writeFileSync(path.join(output, "report.md"), renderProofReport(finalized));
  verifyReceipt(receiptPath, cwd);
  process.stdout.write(`${finalized.verdict} ${receiptPath}\n`);
  return receiptPath;
};

const doctor = (): void => {
  const checks: [string, () => string][] = [
    ["git repository", () => git(["rev-parse", "--show-toplevel"])],
    [
      "GitHub authentication",
      () =>
        execFileSync("gh", ["auth", "status"], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim(),
    ],
    [
      "GitHub media attachments",
      () => {
        const help = execFileSync("gh", ["pr", "comment", "--help"], {
          encoding: "utf-8",
        });
        if (!help.includes("--attach")) {
          fail(
            "GitHub CLI 2.99.0 or newer is required for PR media attachments"
          );
        }
        return "available";
      },
    ],
  ];
  for (const [name, check] of checks) {
    check();
    process.stdout.write(`PASS ${name}\n`);
  }
};

const publish = (args: readonly string[]): void => {
  const pr = flagValue(args, "--pr");
  const receiptPath = flagValue(args, "--receipt");
  const receipt = verifyReceipt(receiptPath);
  if (receipt.verdict !== "PASS" && receipt.verdict !== "PASS_WITH_NOTES") {
    fail(`Only passing proof can be published; receipt is ${receipt.verdict}`);
  }
  doctor();
  const { directory } = readReceipt(receiptPath);
  const prState = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        baseRefOid: Schema.String,
        comments: Schema.Array(Schema.Struct({ body: Schema.String })),
        headRefOid: Schema.String,
      })
    )
  )(
    execFileSync(
      "gh",
      ["pr", "view", pr, "--json", "baseRefOid,comments,headRefOid"],
      {
        cwd: repositoryRoot,
        encoding: "utf-8",
      }
    )
  );
  if (prState.headRefOid !== receipt.headSha) {
    fail(
      `PR head ${prState.headRefOid} does not match proof head ${receipt.headSha}`
    );
  }
  if (prState.baseRefOid !== receipt.base.sha) {
    fail(
      `PR base ${prState.baseRefOid} does not match proof base ${receipt.base.sha}; update the branch and re-prove`
    );
  }
  const marker = `<!-- proofed-delivery:${receipt.headSha} -->`;
  if (prState.comments.some((comment) => comment.body.includes(marker))) {
    fail("Proof for this PR revision is already published");
  }
  const reportPath = path.join(directory, "report.md");
  writeFileSync(reportPath, renderProofReport(receipt));
  const command = ["pr", "comment", pr, "--body-file", reportPath];
  for (const artifact of receipt.artifacts) {
    const artifactPath = path.join(directory, artifact.path);
    command.push("--attach", githubAttachmentArgument(artifactPath, artifact));
  }
  execFileSync("gh", command, { cwd: repositoryRoot, stdio: "inherit" });
};

const usage = `Usage:
  bun run proof -- doctor
  bun run proof -- run [--base origin/main] [--risk auto] [--flow text] [--artifact path#alt] [--focused-check name::command] [--note text] [--verifier-verdict PASS] [--verifier-summary text] [--verifier-source id-or-url] [--rollback text]
  bun run proof -- finalize --receipt path/to/receipt.json [--artifact path#alt] [--flow text] [--note text] [--verifier-verdict PASS --verifier-summary text --verifier-source id-or-url] [--rollback text]
  bun run proof -- verify --receipt path/to/receipt.json
  bun run proof -- publish --pr NUMBER_OR_URL --receipt path/to/receipt.json
`;

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);
  if (command === "doctor") {
    doctor();
    return;
  }
  if (command === "run") {
    await runProof(args);
    return;
  }
  if (command === "finalize") {
    const { receipt } = readReceipt(finalizeProof(args));
    process.exitCode =
      receipt.verdict === "FAIL" || receipt.verdict === "BLOCKED" ? 1 : 0;
    return;
  }
  if (command === "verify") {
    const receipt = verifyReceipt(flagValue(args, "--receipt"));
    process.stdout.write(`PASS proof matches ${receipt.headSha}\n`);
    return;
  }
  if (command === "publish") {
    publish(args);
    return;
  }
  process.stdout.write(usage);
  process.exitCode = command === undefined ? 0 : 1;
};

if (isMain) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ERROR ${message}\n`);
    process.exitCode = 1;
  }
}
