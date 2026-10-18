/**
 * The product API: one group per namespace, every path under `/api/v1`. The server serves
 * `ProductApi`; clients are built from `ProductWireApi`, whose endpoints take their input's
 * encoded side (`endpoint.ts`); `procedureRoutes` is the one route table. Each namespace is
 * declared with `planningCenterGroup` or `plainGroup` (`group.ts`), so every endpoint has its
 * middleware in the same order; a namespace added here without its handlers fails when the
 * server's router is built.
 */
import { access } from "@pcobooster/contracts/http/access";
import { accounts } from "@pcobooster/contracts/http/accounts";
import { catalog } from "@pcobooster/contracts/http/catalog";
import { chordCharts } from "@pcobooster/contracts/http/chord-charts";
import { demo } from "@pcobooster/contracts/http/demo";
import { features } from "@pcobooster/contracts/http/features";
import { feedback } from "@pcobooster/contracts/http/feedback";
import { health } from "@pcobooster/contracts/http/health";
import { neededPositions } from "@pcobooster/contracts/http/needed-positions";
import { people } from "@pcobooster/contracts/http/people";
import { planFiles } from "@pcobooster/contracts/http/plan-files";
import { planItems } from "@pcobooster/contracts/http/plan-items";
import { planPeople } from "@pcobooster/contracts/http/plan-people";
import { planTimes } from "@pcobooster/contracts/http/plan-times";
import { API_PREFIX } from "@pcobooster/contracts/http/route";
import type { ProcedureRoute } from "@pcobooster/contracts/http/route";
import { schedule } from "@pcobooster/contracts/http/schedule";
import { session } from "@pcobooster/contracts/http/session";
import { songs } from "@pcobooster/contracts/http/songs";
import { HttpApi } from "effect/http-api";

const groups = [
  health,
  session,
  accounts,
  features,
  demo,
  feedback,
  access,
  catalog,
  people,
  songs,
  chordCharts,
  planItems,
  planFiles,
  planTimes,
  planPeople,
  neededPositions,
  schedule,
] as const;
const [first, ...rest] = groups;

export const ProductApi = HttpApi.make("pcobooster")
  .add(first.api, ...rest.map((group) => group.api))
  .prefix(API_PREFIX);

export const ProductWireApi = HttpApi.make("pcobooster")
  .add(first.wire, ...rest.map((group) => group.wire))
  .prefix(API_PREFIX);

/** Read endpoint names derived from the declarations, including POST reads. */
export type ReadEndpointNames = {
  [Group in (typeof groups)[number] as Group["wire"]["identifier"]]: Extract<
    Group["declarations"][number],
    { readonly kind: "read" }
  >["name"];
};

/** Every procedure's method, path, param placement, kind, flag, and Planning Center access. */
export const procedureRoutes: readonly ProcedureRoute[] = groups.flatMap(
  (group) => group.routes
);
