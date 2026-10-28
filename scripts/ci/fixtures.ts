import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { onTestFinished } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const turbo = path.join(repositoryRoot, "node_modules/.bin/turbo");
const manifestDependencies = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Schema.Record(Schema.String, Schema.String),
      devDependencies: Schema.Record(Schema.String, Schema.String),
    })
  )
)(readFileSync(path.join(repositoryRoot, "apps/mobile/package.json"), "utf-8"));
const mobileDependencies = Object.fromEntries(
  Object.entries({
    ...manifestDependencies.dependencies,
    ...manifestDependencies.devDependencies,
  }).filter(([name]) =>
    [
      "@pcobooster/client",
      "@pcobooster/contracts",
      "@pcobooster/design-tokens",
    ].includes(name)
  )
);

export const writeFixture = (
  cwd: string,
  file: string,
  contents: string
): void => {
  const target = path.join(cwd, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
};

export const fixtureGit = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();

export const validationFixture = (): string => {
  const cwd = mkdtempSync(path.join(tmpdir(), "pcobooster-ci-"));
  onTestFinished(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
  writeFixture(
    cwd,
    "turbo.json",
    readFileSync(path.join(repositoryRoot, "turbo.json"), "utf-8")
  );
  writeFixture(cwd, ".gitignore", "node_modules\n.turbo\n");
  writeFixture(cwd, ".node-version", "24\n");
  writeFixture(
    cwd,
    "package.json",
    JSON.stringify({
      name: "validation-fixture",
      private: true,
      packageManager: "bun@1.4.2",
      workspaces: ["apps/*", "packages/*"],
      scripts: {
        "test:root": "bun scripts/guard.ts",
        "typecheck:root": "bun scripts/guard.ts",
      },
    })
  );
  for (const [directory, name, dependencies] of [
    ["apps/video", "@pcobooster/video", {}],
    ["apps/web", "@pcobooster/web", { "@pcobooster/client": "workspace:*" }],
    ["apps/mobile", "@pcobooster/mobile", mobileDependencies],
    [
      "packages/client",
      "@pcobooster/client",
      { "@pcobooster/contracts": "workspace:*" },
    ],
    ["packages/contracts", "@pcobooster/contracts", {}],
  ] as const) {
    writeFixture(
      cwd,
      `${directory}/package.json`,
      JSON.stringify({
        name,
        private: true,
        dependencies,
        scripts: {
          test: "bun -e 'process.stdout.write(\"package check\\n\")'",
          typecheck: "bun -e 'process.stdout.write(\"package check\\n\")'",
        },
      })
    );
    writeFixture(cwd, `${directory}/src/input.ts`, "export const input = 1;\n");
  }
  writeFixture(
    cwd,
    "packages/design-tokens/package.json",
    JSON.stringify({
      name: "@pcobooster/design-tokens",
      private: true,
    })
  );
  writeFixture(
    cwd,
    "packages/design-tokens/src/tokens.css",
    ":root { --color: red; }\n"
  );
  writeFixture(
    cwd,
    "scripts/guard.ts",
    'import { readFileSync } from "node:fs"; process.stdout.write(readFileSync("apps/web/src/input.ts", "utf8"));\n'
  );
  execFileSync("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd,
    stdio: "pipe",
  });
  fixtureGit(cwd, "init", "--initial-branch=main");
  fixtureGit(cwd, "add", ".");
  fixtureGit(
    cwd,
    "-c",
    "user.name=CI fixture",
    "-c",
    "user.email=ci@example.com",
    "commit",
    "-m",
    "Initial fixture"
  );
  return cwd;
};

const TurboRun = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({
        taskId: Schema.String,
        hash: Schema.String,
        inputs: Schema.Record(Schema.String, Schema.String),
      })
    ),
  })
);

export const runTurbo = (cwd: string, args: string[], force = false): string =>
  execFileSync(turbo, ["run", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    env: {
      ...process.env,
      TURBO_FORCE: String(force),
      TURBO_REMOTE_ONLY: "false",
      TURBO_CACHE: "local:rw",
      DO_NOT_TRACK: "1",
    },
  });

export const turboPlan = (cwd: string, args: string[]) =>
  Schema.decodeUnknownSync(TurboRun)(runTurbo(cwd, [...args, "--dry=json"]))
    .tasks;
