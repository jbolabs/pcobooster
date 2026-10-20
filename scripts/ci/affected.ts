import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export interface ValidationScope {
  readonly args: string[];
  readonly reason: string;
}

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });

const sharedInput = (file: string): boolean =>
  /^(?:[^/]+\.(?:jsonc?|[cm]?ts|mjs)|bun\.lock|bunfig\.toml|\.node-version)$/u.test(
    file
  ) ||
  [".github/", "patches/", "packages/config/", "scripts/", "stacks/"].some(
    (prefix) => file.startsWith(prefix)
  );

/** Missing history fails closed. The diff includes staged, unstaged, and untracked inputs. */
export const validationScope = (
  cwd: string,
  base?: string
): ValidationScope => {
  if (base === undefined || base === "") {
    return { args: [], reason: "Full validation (no comparison base)." };
  }
  const revision = git(cwd, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]).trim();
  const mergeBase = git(cwd, ["merge-base", revision, "HEAD"]).trim();
  const files = [
    git(cwd, ["diff", "--name-only", "--no-renames", "-z", mergeBase, "--"]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ].flatMap((output) => output.split("\0").filter(Boolean));
  const shared = files.find(sharedInput);
  if (shared !== undefined) {
    return { args: [], reason: `Full validation (shared input: ${shared}).` };
  }
  return {
    // Omitting HEAD includes the working tree. Multiple filters form a union, so repository
    // guards always run even when only an app outside the root dependency graph changes.
    args: [`--filter=...[${mergeBase}]`, "--filter=//"],
    reason: `Affected packages and dependents since ${mergeBase}, plus repository guards.`,
  };
};

const run = (cwd: string, args: string[]): void => {
  process.stdout.write(`bun ${args.join(" ")}\n`);
  const result = spawnSync("bun", args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Validation failed (${result.signal ?? result.status}).`);
  }
};

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      base: { type: "string" },
      github: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const scope = validationScope(
    cwd,
    values.github ? process.env.BASE : (values.base ?? "origin/main")
  );
  process.stdout.write(`${scope.reason}\n`);
  if (values.github) {
    const output = process.env.GITHUB_OUTPUT;
    if (output === undefined || output === "") {
      throw new Error("--github requires GITHUB_OUTPUT.");
    }
    appendFileSync(output, `args=${scope.args.join(" ")}\n`);
  } else if (values["dry-run"]) {
    process.stdout.write(
      "bun run check\nbun run test:install (always uncached)\n"
    );
    run(cwd, [
      "x",
      "--no-install",
      "turbo",
      "run",
      "typecheck",
      "test",
      "//#typecheck:root",
      "//#test:root",
      ...scope.args,
      "--dry",
    ]);
  } else {
    run(cwd, ["run", "check"]);
    run(cwd, ["run", "typecheck", ...scope.args]);
    run(cwd, ["run", "test", ...scope.args]);
  }
}
