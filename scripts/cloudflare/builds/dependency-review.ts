import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";

const auditSchema = Schema.Record(
  Schema.String,
  Schema.Array(Schema.Struct({ id: Schema.Number, severity: Schema.String }))
);
type Audit = typeof auditSchema.Type;
export const introducedSevereAdvisories = (
  base: Audit,
  head: Audit
): string[] => {
  const known = new Set(
    Object.entries(base).flatMap(([name, advisories]) =>
      advisories.map((advisory) => `${name}:${advisory.id}`)
    )
  );
  return Object.entries(head).flatMap(([name, advisories]) =>
    advisories
      .filter(
        (advisory) =>
          ["high", "critical"].includes(advisory.severity) &&
          !known.has(`${name}:${advisory.id}`)
      )
      .map((advisory) => `${name}:${advisory.id}`)
  );
};
const audit = (cwd: string): Audit => {
  const result = spawnSync("bun", ["audit", "--json"], {
    cwd,
    encoding: "utf-8",
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("Dependency audit failed");
  }
  return Schema.decodeUnknownSync(Schema.fromJsonString(auditSchema))(
    result.stdout
  );
};
export const reviewDependencies = (base: string): void => {
  const directory = mkdtempSync(path.join(tmpdir(), "pcobooster-audit-"));
  try {
    writeFileSync(
      path.join(directory, "bun.lock"),
      execFileSync("git", ["show", `${base}:bun.lock`])
    );
    writeFileSync(
      path.join(directory, "package.json"),
      execFileSync("git", ["show", `${base}:package.json`])
    );
    const introduced = introducedSevereAdvisories(
      audit(directory),
      audit(process.cwd())
    );
    if (introduced.length > 0) {
      throw new Error(
        `New high/critical dependency advisories: ${introduced.join(", ")}`
      );
    }
    process.stdout.write(
      "Dependency review: no new high/critical advisories.\n"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
