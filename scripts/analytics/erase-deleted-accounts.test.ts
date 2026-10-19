import { createDatabase } from "@pcobooster/api/db/client";
import { analyticsErasureRequests, user } from "@pcobooster/api/db/schema";
import {
  erasureStatus,
  processDueErasures,
} from "@pcobooster/api/modules/account-deletion/analytics-erasure";
import { deleteAccountData } from "@pcobooster/api/modules/account-deletion/delete-account-data";
import { Schema } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { createLocalD1 } from "../database/local-d1";
import { d1HttpSql } from "./erase-deleted-accounts";

const { runtime, binding } = await createLocalD1("analytics-erase-command");
const database = createDatabase(binding);
const queryBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      sql: Schema.String,
      params: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
    })
  )
);

/** Cloudflare's D1 `query` endpoint in front of a local database. */
const d1Api =
  (calls: string[]) => async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(`${request.method} ${request.url}`);
    const { sql, params } = queryBody(await request.text());
    const { results } = await binding
      .prepare(sql)
      .bind(...params)
      .all();
    return Response.json({
      success: true,
      result: [{ success: true, results }],
    });
  };

describe(d1HttpSql, () => {
  afterAll(async () => {
    await runtime.dispose();
  });

  it("runs the erasure queue through D1's HTTP API", async () => {
    await database.insert(user).values({
      id: "gone",
      name: "Gone",
      email: "g@x.test",
      emailVerified: false,
    });
    await deleteAccountData(
      database,
      "gone",
      new Date("2026-10-19T12:00:00.000Z")
    );
    const calls: string[] = [];
    const run = d1HttpSql({
      fetch: d1Api(calls),
      accountId: "a".repeat(32),
      databaseId: "00000000-0000-4000-8000-000000000000",
      token: "d1-token",
    });
    const erased: string[] = [];

    const summary = await processDueErasures(
      run,
      {
        erase: async (id) => {
          erased.push(id);
          await Promise.resolve();
          return { kind: "accepted" };
        },
      },
      new Date("2026-10-19T13:00:00.000Z")
    );

    const rows = await database
      .select({ passes: analyticsErasureRequests.passesCompleted })
      .from(analyticsErasureRequests);
    expect({
      summary,
      erased,
      status: await erasureStatus(run, new Date("2026-10-19T13:00:00.000Z")),
      passes: rows.map((row) => row.passes),
      endpoint: calls[0],
    }).toStrictEqual({
      summary: { tried: 1, accepted: 1, finished: 0, failed: 0, skipped: 0 },
      erased: ["gone"],
      status: {
        waiting: 1,
        due: 0,
        failing: 0,
        completed: 0,
        oldestOpenRequestedAt: new Date("2026-10-19T12:00:00.000Z"),
      },
      passes: [1],
      endpoint: `POST https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/d1/database/00000000-0000-4000-8000-000000000000/query`,
    });
  });

  it("fails by status without repeating the response body", async () => {
    const run = d1HttpSql({
      fetch: async () => {
        await Promise.resolve();
        return new Response("select ... 'gone' ...", { status: 400 });
      },
      accountId: "a".repeat(32),
      databaseId: "00000000-0000-4000-8000-000000000000",
      token: "d1-token",
    });

    await expect(run("select 1", [])).rejects.toThrow(
      /^D1 request failed with HTTP 400$/u
    );
  });
});
