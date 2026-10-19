/**
 * The product API over HttpApi: every group's handlers and both middlewares, as one layer that
 * adds the API's routes to the Worker's HttpRouter. A group without its handlers fails when the
 * router is built; a handler whose services the middlewares do not provide fails to typecheck.
 * Nothing here is per request: the server and error reporter arrive with each request
 * (`IsolateServer`).
 */
import "@pcobooster/api/http/services";
import type { PlanningCenterAccessDependencies } from "@pcobooster/api/application/planning-center-access";
import { CatalogHandlers } from "@pcobooster/api/http/handlers/catalog";
import { DemoHandlers } from "@pcobooster/api/http/handlers/demo";
import { FeedbackHandlers } from "@pcobooster/api/http/handlers/feedback";
import { HealthHandlers } from "@pcobooster/api/http/handlers/health";
import { IdentityHandlers } from "@pcobooster/api/http/handlers/identity";
import { PeopleHandlers } from "@pcobooster/api/http/handlers/people";
import { RunSheetHandlers } from "@pcobooster/api/http/handlers/run-sheet";
import { scheduleHandlers } from "@pcobooster/api/http/handlers/schedule";
import { SongHandlers } from "@pcobooster/api/http/handlers/songs";
import { UserHandlers } from "@pcobooster/api/http/handlers/user";
import { PlanningCenterSessionLive } from "@pcobooster/api/http/planning-center-session";
import { ProcedureScopeLive } from "@pcobooster/api/http/procedure-scope";
import type { ProcedureScopeOptions } from "@pcobooster/api/http/procedure-scope";
import type { ScheduleAuditDependencies } from "@pcobooster/api/http/schedule-audit";
import { ProductApi } from "@pcobooster/contracts/http/api";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";

export type ProductApiOptions = ProcedureScopeOptions & {
  /** How endpoints resolve Planning Center access; the Worker passes none. */
  readonly access?: PlanningCenterAccessDependencies;
  /** Where schedule writes are audited; the Worker passes none (D1). */
  readonly scheduleAudit?: ScheduleAuditDependencies;
};

export const productApiLayer = (options: ProductApiOptions) =>
  HttpApiBuilder.layer(ProductApi).pipe(
    Layer.provide(
      Layer.mergeAll(
        HealthHandlers,
        IdentityHandlers,
        UserHandlers,
        DemoHandlers,
        FeedbackHandlers,
        CatalogHandlers,
        PeopleHandlers,
        SongHandlers,
        RunSheetHandlers,
        scheduleHandlers(options.scheduleAudit)
      )
    ),
    Layer.provide(
      Layer.mergeAll(
        ProcedureScopeLive(options),
        PlanningCenterSessionLive(options.access)
      )
    )
  );
