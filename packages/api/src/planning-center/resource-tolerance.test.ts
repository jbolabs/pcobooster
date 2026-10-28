/**
 * Planning Center leaves fields out and sends `null` where its docs promise values, and one
 * church's odd row must not fail a whole read. Every fixture value here is made up.
 */
import { createBasicPlanningCenterClient } from "@pcobooster/api/planning-center/core-client";
import type {
  PlanningCenterCoreClient,
  PlanningCenterError,
} from "@pcobooster/api/planning-center/core-client";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { recordLogs } from "@pcobooster/api/testing/logs";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import type {
  JsonObject,
  JsonValue,
} from "@pcobooster/planning-center-models/json";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

/** A value no log line or error may repeat. */
const PRIVATE = "Private Fixture Name";

const clientAnswering = (body: JsonValue): PlanningCenterCoreClient =>
  createBasicPlanningCenterClient(
    testPlanningCenterToken,
    httpClientFor(
      vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(
          async () => await Promise.resolve(Response.json(body))
        )
    )
  );

const failureOf = async <Value>(
  effect: Effect.Effect<Value, PlanningCenterError>
): Promise<PlanningCenterError | undefined> => {
  const exit = await Effect.runPromiseExit(effect);
  return Exit.isSuccess(exit)
    ? undefined
    : exit.cause.reasons.find(Cause.isFailReason)?.error;
};

const team = {
  type: "Team",
  id: "10",
  attributes: { name: "Band" },
  relationships: { service_type: { data: { type: "ServiceType", id: "1" } } },
};

/** One row of each collection the plan page's team positions read. */
const resources = {
  TeamPosition: (id: string): JsonObject => ({
    type: "TeamPosition",
    id,
    attributes: { name: PRIVATE, sequence: 1, tags: [], tag_groups: [] },
    relationships: {
      team: {
        data: { type: "Team", id: "10" },
        links: { related: "https://example.test/teams/10" },
      },
      tags: { data: [] },
    },
    links: { self: `https://example.test/team_positions/${id}` },
  }),
  NeededPosition: (id: string): JsonObject => ({
    type: "NeededPosition",
    id,
    attributes: { quantity: 1, team_position_name: PRIVATE },
    relationships: {
      team: { data: { type: "Team", id: "10" } },
      time: { data: { type: "PlanTime", id: "20" } },
      time_preference_option: { data: null },
    },
  }),
  PlanPerson: (id: string): JsonObject => ({
    type: "PlanPerson",
    id,
    attributes: { name: PRIVATE, status: "C", team_position_name: PRIVATE },
    relationships: {
      person: { data: { type: "Person", id: "30" } },
      team: { data: { type: "Team", id: "10" } },
      plan: { data: { type: "Plan", id: "40" } },
    },
  }),
} as const;

const kinds = ["TeamPosition", "NeededPosition", "PlanPerson"] as const;

const collection = (
  data: JsonValue[],
  envelope: JsonObject = {}
): JsonObject => ({
  data,
  included: [team],
  meta: { total_count: data.length, count: data.length },
  links: { self: "https://example.test/collection" },
  ...envelope,
});

type Row = JsonObject;

const relationshipsOf = (row: Row): JsonObject => {
  const { relationships } = row;
  if (
    relationships === null ||
    relationships === undefined ||
    Array.isArray(relationships) ||
    !(relationships instanceof Object)
  ) {
    throw new Error("Every fixture row has relationships");
  }
  return relationships;
};

/** A field Planning Center may leave out or malform, and what the row's `team` link reads as. */
const relationshipCases: [
  name: string,
  breakRow: (row: Row) => void,
  team: unknown,
][] = [
  [
    "relationships is null",
    (row) => {
      row.relationships = null;
    },
    undefined,
  ],
  [
    "relationships is a list",
    (row) => {
      row.relationships = [];
    },
    undefined,
  ],
  [
    "the team relationship is null",
    (row) => {
      relationshipsOf(row).team = null;
    },
    undefined,
  ],
  [
    "the team relationship is text",
    (row) => {
      relationshipsOf(row).team = PRIVATE;
    },
    undefined,
  ],
  [
    "the team link has a null id",
    (row) => {
      relationshipsOf(row).team = { data: { type: "Team", id: null } };
    },
    { data: null },
  ],
  [
    "the team link has no id",
    (row) => {
      relationshipsOf(row).team = { data: { type: "Team" } };
    },
    { data: null },
  ],
  [
    "the team link has a numeric id",
    (row) => {
      relationshipsOf(row).team = { data: { type: "Team", id: 10 } };
    },
    { data: null },
  ],
  [
    "the team link has no type",
    (row) => {
      relationshipsOf(row).team = { data: { id: "10" } };
    },
    { data: null },
  ],
  [
    "the team link list holds a null",
    (row) => {
      relationshipsOf(row).team = { data: [null] };
    },
    { data: null },
  ],
  [
    "the team relationship's links are null",
    (row) => {
      relationshipsOf(row).team = {
        data: { type: "Team", id: "10" },
        links: null,
      };
    },
    { data: { type: "Team", id: "10" } },
  ],
  [
    "the team relationship's related link is an object",
    (row) => {
      relationshipsOf(row).team = {
        data: { type: "Team", id: "10" },
        links: { related: { href: "https://example.test" } },
      };
    },
    { data: { type: "Team", id: "10" }, links: {} },
  ],
];

const attributeCases: [name: string, breakRow: (row: Row) => void][] = [
  [
    "attributes is null",
    (row) => {
      row.attributes = null;
    },
  ],
  [
    "attributes is missing",
    (row) => {
      delete row.attributes;
    },
  ],
  [
    "attributes is a list",
    (row) => {
      row.attributes = [PRIVATE];
    },
  ],
];

/** Rows without a usable identity: nothing can refer to them, so they are dropped. */
const unusableRowCases: [
  name: string,
  breakRow: (row: Row) => JsonValue,
  issuePath: string,
][] = [
  ["its id is null", (row) => ({ ...row, id: null }), "data[1].id"],
  ["its id is missing", ({ id: _id, ...row }) => row, "data[1].id"],
  [
    "its id is an object",
    (row) => ({ ...row, id: { name: PRIVATE } }),
    "data[1].id",
  ],
  ["its type is null", (row) => ({ ...row, type: null }), "data[1].type"],
  ["the row is null", () => null, "data[1]"],
  ["the row is text", () => PRIVATE, "data[1]"],
];

const envelopeCases: [name: string, envelope: JsonObject][] = [
  ["included is null", { included: null }],
  ["meta is null", { meta: null }],
  ["meta.total_count is null", { meta: { total_count: null } }],
  ["meta.count is text", { meta: { count: PRIVATE } }],
  ["meta.next is null", { meta: { next: null } }],
  ["meta.next.offset is null", { meta: { next: { offset: null } } }],
  ["meta.prev is empty", { meta: { prev: {} } }],
  ["links is null", { links: null }],
  ["links.next is an object", { links: { next: { href: PRIVATE } } }],
  ["links.self is a number", { links: { self: 5 } }],
];

describe("Planning Center collections with null or missing fields", () => {
  describe.each(kinds)("%s rows", (kind) => {
    const resource = resources[kind];

    it.each(relationshipCases)(
      "keeps the row when %s",
      async (_name, breakRow, expectedTeam) => {
        const broken = structuredClone(resource("2"));
        breakRow(broken);
        const response = await Effect.runPromise(
          clientAnswering(collection([resource("1"), broken])).fetchCollection(
            "/services/v2/fixture"
          )
        );
        expect(response.data.map((row) => row.id)).toStrictEqual(["1", "2"]);
        expect(response.data[1]?.relationships?.team).toStrictEqual(
          expectedTeam
        );
      }
    );

    it.each(attributeCases)(
      "keeps the row with no attributes when %s",
      async (_name, breakRow) => {
        const broken = structuredClone(resource("2"));
        breakRow(broken);
        const response = await Effect.runPromise(
          clientAnswering(collection([resource("1"), broken])).fetchCollection(
            "/services/v2/fixture"
          )
        );
        expect(
          response.data.map((row) => [row.id, row.attributes])
        ).toStrictEqual([
          ["1", resource("1").attributes],
          ["2", {}],
        ]);
      }
    );

    it.each(unusableRowCases)(
      "drops only the row when %s, logging where it broke without its values",
      async (_name, breakRow, issuePath) => {
        const { lines, capture } = recordLogs();
        const response = await Effect.runPromise(
          capture(
            clientAnswering(
              collection([resource("1"), breakRow(resource("2"))])
            ).fetchCollection("/services/v2/fixture")
          )
        );
        expect(response.data).toStrictEqual([resource("1")]);
        const dropped = lines.find(
          (line) =>
            line.message === "Dropped Planning Center rows it could not read"
        );
        expect(dropped?.level).toBe("warn");
        expect(JSON.stringify(dropped?.fields)).toContain(issuePath);
        expect(JSON.stringify(lines)).not.toContain(PRIVATE);
      }
    );

    it("drops an unreadable included row and keeps the rest", async () => {
      const response = await Effect.runPromise(
        clientAnswering(
          collection([resource("1")], {
            included: [team, { ...team, id: null }, null],
          })
        ).fetchCollection("/services/v2/fixture")
      );
      expect(response.included).toStrictEqual([team]);
    });

    it.each(envelopeCases)(
      "reads the rows when %s",
      async (_name, envelope) => {
        const response = await Effect.runPromise(
          clientAnswering(
            collection([resource("1"), resource("2")], envelope)
          ).fetchCollection("/services/v2/fixture")
        );
        expect(response.data).toStrictEqual([resource("1"), resource("2")]);
      }
    );
  });

  it("names the field when a response is unusable, without its values", async () => {
    const error = await failureOf(
      clientAnswering({
        data: { type: "Plan", id: { title: PRIVATE } },
      }).fetch("/services/v2/fixture/1")
    );
    expect(error).toMatchObject({
      _tag: "PlanningCenterApiError",
      code: "INVALID_RESPONSE",
      message:
        "Planning Center returned an invalid response (data.id: Expected string)",
    });
    expect(JSON.stringify(error)).not.toContain(PRIVATE);
  });

  it("names the field when a collection has no rows at all", async () => {
    const error = await failureOf(
      clientAnswering({ data: null, meta: { count: 0 } }).fetchCollection(
        "/services/v2/fixture"
      )
    );
    expect(error?.message).toBe(
      "Planning Center returned an invalid response (data: Expected array | object)"
    );
  });
});
