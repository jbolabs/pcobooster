import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  applyAlchemyFormat,
  MigrationError,
  readMigrationRecords,
} from "alchemy/SQL/Migrations/index";
import type {
  MigrationRecord,
  SqlExecutor,
} from "alchemy/SQL/Migrations/index";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { createIsolatedMiniflare } from "../testing/miniflare";

const dir = path.resolve(import.meta.dirname, "../../packages/api/migrations");
const readRecords = async () =>
  await Effect.runPromise(
    readMigrationRecords(dir).pipe(Effect.provide(NodeServices.layer))
  );
const oldNames = ["0000_high_black_tarantula.sql", "0001_feedback.sql"];
const directoryNames = ["20260923202727_init", "20260923233754_feedback"];
const historyTable = `CREATE TABLE __alchemy_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT)`;

const setup = async (name: string) => {
  const runtime = await createIsolatedMiniflare(`migration-${name}`, {
    workers: [
      {
        config: {
          name: `migration-${name}`,
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
          env: { DB: { type: "d1", id: `migration-${name}` } },
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

const apply = async (executor: SqlExecutor, records: MigrationRecord[]) => {
  await Effect.runPromise(
    applyAlchemyFormat({ executor, table: "__alchemy_migrations", records })
  );
};

// Use real historical DDL for existing data and both historically recorded name formats.
const seed = async (
  executor: SqlExecutor,
  records: MigrationRecord[],
  mode: "empty" | "old" | "directory" | "mixed"
) => {
  if (mode === "empty") {
    return;
  }
  for (const record of records.slice(0, 2)) {
    // eslint-disable-next-line no-await-in-loop -- Apply table DDL in migration order.
    await Effect.runPromise(executor.batch(record.statements));
  }
  await Effect.runPromise(
    executor.batch([
      historyTable,
      "INSERT INTO user (id,name,email,emailVerified,updatedAt) VALUES ('preserved','Preserved','preserved@example.com',0,1)",
    ])
  );
  for (const record of records.slice(0, 2)) {
    let rows = [record, ...(record.aliases ?? [])];
    if (mode === "old") {
      rows = [...(record.aliases ?? [])];
    }
    if (mode === "directory") {
      rows = [record];
    }
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop -- Seed history in recorded application order.
      await Effect.runPromise(
        executor.query(
          "INSERT INTO __alchemy_migrations (name,hash) VALUES (?,?)",
          [row.name, row.hash]
        )
      );
    }
  }
};

describe("Alchemy migration history compatibility", () => {
  it.each(["empty", "old", "directory", "mixed"] as const)(
    "applies new migrations to %s history and preserves existing data and names",
    async (mode) => {
      const records = await readRecords();
      const { runtime, db, executor } = await setup(mode);
      try {
        await seed(executor, records, mode);
        await apply(executor, records);
        await apply(executor, records);
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
        const preserved = await db
          .prepare("SELECT name FROM user WHERE id='preserved'")
          .first("name");
        expect(preserved).toBe(mode === "empty" ? null : "Preserved");
        const result = await db
          .prepare("SELECT name FROM __alchemy_migrations ORDER BY name")
          .all<{ name: string }>();
        const names = result.results.map((row) => row.name);
        let expected = [...directoryNames, records[2].name];
        if (mode === "old") {
          expected = [...oldNames, records[2].name];
        }
        if (mode === "mixed") {
          expected = [...oldNames, ...directoryNames, records[2].name];
        }
        expect(names).toStrictEqual(expected.toSorted());
      } finally {
        await runtime.dispose();
      }
    }
  );

  it.each(["unknown", "changed-old", "changed-directory"])(
    "rejects %s history without applying new schema",
    async (mode) => {
      const records = await readRecords();
      const { runtime, db, executor } = await setup(mode);
      try {
        await seed(executor, records, "mixed");
        const statement =
          mode === "unknown"
            ? db.prepare(
                "INSERT INTO __alchemy_migrations (name,hash) VALUES ('unknown.sql','unexpected')"
              )
            : db
                .prepare(
                  "UPDATE __alchemy_migrations SET hash='altered' WHERE name=?"
                )
                .bind(mode === "changed-old" ? oldNames[0] : directoryNames[0]);
        await statement.run();
        const result = await Effect.runPromiseExit(
          applyAlchemyFormat({
            executor,
            table: "__alchemy_migrations",
            records,
          })
        );
        expect(Exit.isFailure(result)).toBeTruthy();
        await expect(
          db
            .prepare(
              "SELECT count(*) AS count FROM sqlite_master WHERE name='song_catalog_revision'"
            )
            .first("count")
        ).resolves.toBe(0);
        await expect(
          db.prepare("SELECT name FROM user WHERE id='preserved'").first("name")
        ).resolves.toBe("Preserved");
      } finally {
        await runtime.dispose();
      }
    }
  );

  it("pins both immutable legacy hashes separately from the current directory hashes", async () => {
    const records = await readRecords();
    expect(records.slice(0, 2).map((record) => record.aliases)).toStrictEqual([
      [
        {
          name: "0000_high_black_tarantula.sql",
          hash: "cc5846ad12f63d1d75089ea69d02158183e04b85a1554fa6f5fc180b1f0e3456",
        },
      ],
      [
        {
          name: "0001_feedback.sql",
          hash: "04e327ce9012ed7d405128a83a2ca38c59229d698f8c6cd448c7458807e48e3c",
        },
      ],
    ]);
    for (const record of records.slice(0, 2)) {
      // eslint-disable-next-line no-await-in-loop -- Independently verify each immutable SQL hash.
      const sql = await readFile(path.join(dir, record.name, "migration.sql"));
      expect(record.hash).toBe(createHash("sha256").update(sql).digest("hex"));
    }
  });
});
