import { moduleLog } from "@pcobooster/api/logging";
import type {
  PlanningCenterCoreClient,
  PlanningCenterError,
} from "@pcobooster/api/planning-center/core-client";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const log = moduleLog("planning-center/plan-items");
const PLAN_ITEM_INCLUDES = "song,arrangement,key,item_notes,item_times";

interface PlanItemsResponse {
  data: PCResource[];
  included: PCResource[];
}

interface PlanItemResponse {
  data: PCResource;
  included: PCResource[];
}

const buildItemPayload = (attributes: JsonObject, id?: string) => ({
  data: {
    type: "Item",
    ...(isNonEmptyString(id) ? { id } : undefined),
    attributes,
  },
});

export class PlanningCenterPlanItemsService {
  private readonly core: PlanningCenterCoreClient;
  constructor(core: PlanningCenterCoreClient) {
    this.core = core;
  }

  getPlanItems(
    serviceTypeId: string,
    planId: string
  ): Effect.Effect<PlanItemsResponse, PlanningCenterError> {
    // A write may reach another isolate, so an isolate-local list cache cannot
    // provide read-after-write consistency for the run sheet.
    return this.core
      .fetchAllWithIncluded(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items`,
        { include: PLAN_ITEM_INCLUDES },
        5
      )
      .pipe(
        Effect.tap((result) =>
          log.info("Plan items fetched", {
            serviceTypeId,
            planId,
            itemCount: result.data.length,
          })
        )
      );
  }

  getPlanItem(
    serviceTypeId: string,
    planId: string,
    itemId: string
  ): Effect.Effect<PlanItemResponse, PlanningCenterError> {
    return Effect.map(
      this.core.fetch(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items/${itemId}?include=${PLAN_ITEM_INCLUDES}`
      ),
      (response) => ({
        data: response.data,
        included: response.included ?? [],
      })
    );
  }

  createPlanItem(
    serviceTypeId: string,
    planId: string,
    attributes: JsonObject
  ): Effect.Effect<PlanItemResponse, PlanningCenterError> {
    return this.core
      .fetch(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items?include=song,arrangement,key`,
        { method: "POST", body: buildItemPayload(attributes) }
      )
      .pipe(
        Effect.map((response) => ({
          data: response.data,
          included: response.included ?? [],
        }))
      );
  }

  updatePlanItem(
    serviceTypeId: string,
    planId: string,
    itemId: string,
    attributes: JsonObject
  ): Effect.Effect<PlanItemResponse, PlanningCenterError> {
    return this.core
      .fetch(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items/${itemId}?include=song,arrangement,key`,
        { method: "PATCH", body: buildItemPayload(attributes, itemId) }
      )
      .pipe(
        Effect.map((response) => ({
          data: response.data,
          included: response.included ?? [],
        }))
      );
  }

  deletePlanItem(
    serviceTypeId: string,
    planId: string,
    itemId: string
  ): Effect.Effect<void, PlanningCenterError> {
    return this.core
      .request(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/items/${itemId}`,
        { method: "DELETE" }
      )
      .pipe(Effect.asVoid);
  }

  reorderPlanItems(
    serviceTypeId: string,
    planId: string,
    sequence: string[]
  ): Effect.Effect<void, PlanningCenterError> {
    return this.core
      .request(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/item_reorder`,
        {
          method: "POST",
          body: {
            data: {
              type: "PlanItemReorder",
              attributes: { sequence },
            },
          },
        }
      )
      .pipe(Effect.asVoid);
  }
}
