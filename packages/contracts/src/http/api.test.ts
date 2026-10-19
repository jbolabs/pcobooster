/**
 * The product API against its route table and against what main served before the cutover.
 * `main-procedures.fixture.json` was extracted once from main (its `source` says which commit and
 * files): each procedure's name, how main's transport ran it (`wrapper`), whether it is a read
 * or a write, and its feature flag.
 */
import {
  procedureRoutes,
  ProductApi,
  ProductWireApi,
} from "@pcobooster/contracts/http/api";
import { procedureKindOf } from "@pcobooster/contracts/http/procedure-kind";
import { requiredFeatureOf } from "@pcobooster/contracts/http/required-feature";
import { matchRoute } from "@pcobooster/contracts/http/route";
import { Function, Schema } from "effect";
import { HttpApi } from "effect/http-api";
import type { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { describe, expect, it } from "vitest";

import mainProcedures from "./main-procedures.fixture.json" with { type: "json" };

const fixtureSchema = Schema.Struct({
  source: Schema.String,
  procedures: Schema.Array(
    Schema.Struct({
      tag: Schema.String,
      wrapper: Schema.Literals([
        "read",
        "prepared-write",
        "committed-write",
        "audited-schedule-write",
        "plain",
      ]),
      kind: Schema.Literals(["read", "write"]),
      feature: Schema.NullOr(Schema.Literals(["people", "chordCharts"])),
    })
  ),
});
const main = Schema.decodeUnknownSync(fixtureSchema)(mainProcedures);

/** Main called liveness `health`; the API names it `health.get` (`api.health.get()`). */
const mainTag = (tag: string) => (tag === "health" ? "health.get" : tag);

interface Reflected {
  readonly tag: string;
  readonly endpoint: HttpApiEndpoint.Top;
  readonly middleware: readonly string[];
}

const reflect = <Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<"pcobooster", Groups>
) => {
  const endpoints: Reflected[] = [];
  HttpApi.reflect(api, {
    onGroup: Function.constVoid,
    onEndpoint: ({ group, endpoint }) => {
      endpoints.push({
        tag: `${group.identifier}.${endpoint.identifier}`,
        endpoint,
        middleware: [...endpoint.middlewares].map((service) => service.key),
      });
    },
  });
  return endpoints;
};

const served = reflect(ProductApi);
const routeOf = ({ tag, endpoint }: Reflected) => ({
  tag,
  method: endpoint.method,
  path: endpoint.path,
});
const byTag = (left: { tag: string }, right: { tag: string }) =>
  left.tag.localeCompare(right.tag);

describe("the procedures route table", () => {
  it("names every endpoint the server serves, once, with its method and path", () => {
    const tags = procedureRoutes.map(({ tag }) => tag);

    expect(new Set(tags).size).toBe(tags.length);
    expect(
      procedureRoutes
        .map(({ tag, method, path }) => ({ tag, method, path }))
        .toSorted(byTag)
    ).toStrictEqual(served.map(routeOf).toSorted(byTag));
  });

  it("lists each route's path params in path order, and its kind and flag as annotated", () => {
    for (const route of procedureRoutes) {
      const inPath = [...route.path.matchAll(/:(?<name>[A-Za-z]+)/gu)].map(
        (match) => match.groups?.name
      );
      const endpoint = served.find(
        (entry) => entry.tag === route.tag
      )?.endpoint;

      expect({ tag: route.tag, params: route.params }).toStrictEqual({
        tag: route.tag,
        params: inPath,
      });
      expect([
        endpoint === undefined ? undefined : procedureKindOf(endpoint),
        endpoint === undefined
          ? undefined
          : (requiredFeatureOf(endpoint) ?? null),
      ]).toStrictEqual([route.kind, route.feature]);
    }
  });

  it("sends a read's input in the URL unless it is a POST read, and every write's in its body or query", () => {
    expect(
      procedureRoutes
        .filter(({ method, kind }) => kind === "read" && method !== "GET")
        .map(({ tag, method, input }) => [tag, method, input])
    ).toStrictEqual([
      ["people.planWindowHistory", "POST", "body"],
      ["people.candidateDetails", "POST", "body"],
      ["people.dashboardPerson", "POST", "body"],
    ]);
    expect(
      procedureRoutes
        .filter(({ method }) => method === "DELETE")
        .every(({ input }) => input !== "body")
    ).toBeTruthy();
  });

  it("gives clients the same endpoints, by group and name", () => {
    expect(reflect(ProductWireApi).map(routeOf).toSorted(byTag)).toStrictEqual(
      served.map(routeOf).toSorted(byTag)
    );
  });

  it("wraps every endpoint in ProcedureScope, outside its namespace middleware", () => {
    // HttpApi applies the last middleware outermost.
    expect(
      [
        ...new Set(served.map(({ middleware }) => middleware.join(" < "))),
      ].toSorted((left, right) => left.localeCompare(right))
    ).toStrictEqual([
      "@pcobooster/http/PlanningCenterSession < @pcobooster/http/ProcedureScope",
      "@pcobooster/http/ProcedureScope",
    ]);
  });
});

/** Procedures added after the cutover, so they are absent from main's list. */
const addedSinceCutover = [
  { tag: "catalog.planWindow", kind: "read", feature: null },
  { tag: "planFiles.list", kind: "read", feature: null },
  { tag: "planFiles.open", kind: "read", feature: null },
  { tag: "songs.attachmentLink", kind: "read", feature: "chordCharts" },
  { tag: "songs.attachments", kind: "read", feature: "chordCharts" },
  { tag: "songs.schedule", kind: "read", feature: null },
] as const;
const addedTags = new Set<string>(addedSinceCutover.map(({ tag }) => tag));

describe("parity with the procedures main served before the cutover", () => {
  it("declares main's 49 procedures, each a read or a write as main ran it, with main's flags", () => {
    expect(main.procedures).toHaveLength(49);
    expect(
      procedureRoutes
        .filter(({ tag }) => !addedTags.has(tag))
        .map(({ tag, kind, feature }) => ({ tag, kind, feature }))
        .toSorted(byTag)
    ).toStrictEqual(
      main.procedures
        .map(({ tag, kind, feature }) => ({ tag: mainTag(tag), kind, feature }))
        .toSorted(byTag)
    );
  });

  it("adds only the listed procedures, as declared", () => {
    expect(
      procedureRoutes
        .filter(({ tag }) => addedTags.has(tag))
        .map(({ tag, kind, feature }) => ({ tag, kind, feature }))
        .toSorted(byTag)
    ).toStrictEqual([...addedSinceCutover].toSorted(byTag));
  });

  it("resolves Planning Center access for exactly the procedures main did", () => {
    expect(
      procedureRoutes
        .filter(({ planningCenter }) => !planningCenter)
        .map(({ tag }) => tag)
        .toSorted((left, right) => left.localeCompare(right))
    ).toStrictEqual(
      main.procedures
        .filter(({ wrapper }) => wrapper === "plain")
        .map(({ tag }) => mainTag(tag))
        .toSorted((left, right) => left.localeCompare(right))
    );
  });
});

describe(matchRoute, () => {
  const items = "/api/v1/service-types/st-1/plans/plan-1/items";

  it.each([
    ["PUT", `${items}/order`, "planItems.reorder"],
    ["PATCH", `${items}/order`, "planItems.update"],
    ["PATCH", `${items}/item-1`, "planItems.update"],
    ["POST", "/api/v1/people/plan-window-history", "people.planWindowHistory"],
    ["GET", "/api/v1/service-types/st-1/plan-window", "catalog.planWindow"],
    ["GET", "/api/v1/songs/suggestions", "songs.suggestions"],
    ["GET", "/api/v1/songs/song-1/history", "songs.history"],
    ["GET", "/api/v1/songs/song-1/schedule", "songs.schedule"],
  ])("finds %s %s as %s", (method, path, tag) => {
    const match = matchRoute(procedureRoutes, method, path);

    expect(match.kind === "found" ? match.route.tag : match.kind).toBe(tag);
  });

  it("decodes path params", () => {
    expect(
      matchRoute(procedureRoutes, "DELETE", "/api/v1/plan-people/a%2Fb")
    ).toMatchObject({
      kind: "found",
      route: { tag: "schedule.remove" },
      params: { planPersonId: "a/b" },
    });
  });

  it("names the methods a known path allows, and nothing for an unknown one", () => {
    expect([
      matchRoute(procedureRoutes, "GET", "/api/v1/plan-people/pp-1"),
      matchRoute(procedureRoutes, "GET", "/api/v1/retired"),
    ]).toStrictEqual([
      {
        kind: "wrong-method",
        allow: ["DELETE", "PATCH"],
        route: "/api/v1/plan-people/:planPersonId",
      },
      { kind: "unknown" },
    ]);
  });
});
