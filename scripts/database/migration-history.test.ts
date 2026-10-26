import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  applyAlchemyFormat,
  MigrationError,
  readMigrationRecords,
} from "@alchemy.run/sql/Migrations/index";
import type { SqlExecutor } from "@alchemy.run/sql/Migrations/index";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createIsolatedMiniflare } from "../testing/miniflare";

/**
 * Alchemy records each applied migration by directory name and SQL hash in `__alchemy_migrations`
 * and refuses to deploy when an applied migration was renamed, edited, or deleted. These tests run
 * the stock Alchemy applier against D1 and catch history rewrites in review instead of at deploy.
 */

const repoRoot = path.resolve(import.meta.dirname, "../..");
const migrationsPath = "packages/api/migrations";
const dir = path.join(repoRoot, migrationsPath);
const MIGRATION_FILE =
  /^packages\/api\/migrations\/(?<name>[^/]+)\/migration\.sql$/u;

const committedNames = (): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

const setup = async () => {
  const runtime = await createIsolatedMiniflare("migration-history", {
    workers: [
      {
        config: {
          name: "migration-history",
          compatibilityDate: "2026-09-23",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents:
                  "export default { fetch() { return new Response('OK'); } };",
              },
            },
          },
          env: { DB: { type: "d1", id: "migration-history" } },
        },
      },
    ],
  });
  const db = await runtime.getD1Database("DB");
  const executor: SqlExecutor = {
    dialect: "sqlite",
    transactionalDdl: false,
    query: (sql, params = []) =>
      Effect.tryPromise({
        try: async () => {
          const result = await db
            .prepare(sql)
            .bind(...params)
            .all();
          return result.results;
        },
        catch: (cause) =>
          new MigrationError({ message: "D1 query failed", cause }),
      }),
    batch: (statements) =>
      Effect.tryPromise({
        try: async () => {
          await db.batch(statements.map((sql) => db.prepare(sql)));
        },
        catch: (cause) =>
          new MigrationError({ message: "D1 migration failed", cause }),
      }),
  };
  return { runtime, db, executor };
};

const deploy = async (executor: SqlExecutor) => {
  const records = await Effect.runPromise(
    readMigrationRecords(dir).pipe(Effect.provide(NodeServices.layer))
  );
  await Effect.runPromise(
    applyAlchemyFormat({ executor, table: "__alchemy_migrations", records })
  );
};

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim();

describe("D1 migration history", () => {
  it("applies every committed migration to a new database, and a repeat deploy applies none", async () => {
    const { runtime, db, executor } = await setup();
    try {
      await deploy(executor);
      await deploy(executor);
      await db
        .prepare(
          "INSERT INTO song_catalog_revision (scope,revision) VALUES ('verified',7)"
        )
        .run();
      await expect(
        db
          .prepare(
            "SELECT revision FROM song_catalog_revision WHERE scope='verified'"
          )
          .first("revision")
      ).resolves.toBe(7);
      const history = await db
        .prepare("SELECT name FROM __alchemy_migrations ORDER BY name")
        .all<{ name: string }>();
      expect(history.results.map((row) => row.name)).toStrictEqual(
        committedNames()
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps every migration already on main byte for byte", () => {
    // Deployed databases recorded these by name and hash; add a new migration instead.
    const base = git("merge-base", "HEAD", "origin/main");
    const merged = git(
      "ls-tree",
      "-r",
      "--name-only",
      base,
      "--",
      migrationsPath
    )
      .split("\n")
      .flatMap((file) => {
        const name = MIGRATION_FILE.exec(file)?.groups?.name;
        return name === undefined ? [] : [{ file, name }];
      });
    const status = (file: string): string => {
      let current: Buffer;
      try {
        current = readFileSync(path.join(repoRoot, file));
      } catch {
        return "renamed or deleted";
      }
      const original = execFileSync("git", ["show", `${base}:${file}`], {
        cwd: repoRoot,
      });
      return current.equals(original) ? "unchanged" : "edited";
    };
    expect(merged.length).toBeGreaterThan(0);
    expect(
      Object.fromEntries(merged.map(({ file, name }) => [name, status(file)]))
    ).toStrictEqual(
      Object.fromEntries(merged.map(({ name }) => [name, "unchanged"]))
    );
  });
});
