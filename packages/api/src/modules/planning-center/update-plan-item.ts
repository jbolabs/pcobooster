import { moduleLog } from "@pcobooster/api/logging";
import {
  buildPlanItemAttributes,
  resolvePlanItemSongDefaults,
} from "@pcobooster/api/modules/planning-center/plan-item-payload";
import type { LoadSongOptions } from "@pcobooster/api/modules/planning-center/plan-item-payload";
import {
  getSingleRelationshipId,
  normalizePlanItem,
} from "@pcobooster/api/modules/planning-center/plan-items-shared";
import { listedValidationErrors } from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type {
  PlanItemUpdateAttributes,
  PlanningCenterPlanItemsService,
} from "@pcobooster/api/planning-center/services/plan-items-service";
import type { PlanningCenterSongsService } from "@pcobooster/api/planning-center/services/songs-service";
import { findIncluded } from "@pcobooster/api/planning-center/utils";
import { isNumber, isString } from "@pcobooster/planning-center-models/json";
import type { JsonValue } from "@pcobooster/planning-center-models/json";
import { clampPlanItemLength } from "@pcobooster/planning-center-models/plan-item-draft";
import type {
  PlanItem,
  PlanItemServicePosition,
} from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const log = moduleLog("planning-center/update-plan-item");

type DurationDiagnostic =
  | { readonly state: "omitted" | "null" | "invalid" }
  | { readonly state: "number"; readonly seconds: number };

// Keep missing/null/invalid distinct without copying provider text or song content.
const describeLength = (value: JsonValue | undefined): DurationDiagnostic => {
  if (value === undefined) {
    return { state: "omitted" };
  }
  if (value === null) {
    return { state: "null" };
  }
  return isNumber(value) && Number.isFinite(value)
    ? { state: "number", seconds: value }
    : { state: "invalid" };
};

export interface UpdatePlanItemInput {
  serviceTypeId: string;
  planId: string;
  itemId: string;
  title?: string;
  servicePosition?: PlanItemServicePosition;
  length?: number | null;
  description?: string;
  htmlDetails?: string;
  songId?: string;
  arrangementId?: string;
  keyId?: string;
  selectedLayoutId?: string;
  customArrangementSequence?: string[];
}

export interface PreparedUpdatePlanItem {
  readonly serviceTypeId: string;
  readonly planId: string;
  readonly itemId: string;
  readonly attributes: PlanItemUpdateAttributes;
  readonly diagnostics: {
    readonly songId: string | null;
    readonly arrangementId: string | null;
    readonly currentArrangementId: string | null;
    readonly itemType: string;
    readonly storedLength: DurationDiagnostic;
    readonly currentArrangementLength: DurationDiagnostic;
    readonly requestedLength: DurationDiagnostic;
  };
}

export const prepareUpdatePlanItem = (
  input: UpdatePlanItemInput,
  loadSongOptions: LoadSongOptions,
  planItemsService: Pick<PlanningCenterPlanItemsService, "getPlanItem">
): Effect.Effect<PreparedUpdatePlanItem, PlanningCenterError> =>
  Effect.gen(function* prepareUpdate() {
    // Existing clients omit header length. Read the provider type rather than trusting callers.
    const current = yield* planItemsService.getPlanItem(
      input.serviceTypeId,
      input.planId,
      input.itemId
    );
    const resolved = yield* resolvePlanItemSongDefaults(input, loadSongOptions);
    // A metadata edit must carry the saved duration too: omitting it produced a
    // spurious 24-hour rejection on a real zero-length PlanSong. Null means clear.
    const length =
      resolved.length === undefined
        ? current.data.attributes.length
        : resolved.length;
    const attributes: PlanItemUpdateAttributes = {
      ...buildPlanItemAttributes(resolved),
      length:
        current.data.attributes.item_type === "header"
          ? 0
          : clampPlanItemLength(isNumber(length) ? length : 0),
    };
    const currentArrangementId = getSingleRelationshipId(
      current.data.relationships?.arrangement
    );
    const currentArrangement =
      currentArrangementId === null
        ? undefined
        : findIncluded(current.included, "Arrangement", currentArrangementId);
    const itemType = current.data.attributes.item_type;
    return {
      diagnostics: {
        songId:
          resolved.songId ??
          getSingleRelationshipId(current.data.relationships?.song),
        arrangementId: resolved.arrangementId ?? currentArrangementId,
        currentArrangementId,
        itemType:
          itemType === "header" || itemType === "song" || itemType === "media"
            ? itemType
            : "item",
        storedLength: describeLength(current.data.attributes.length),
        currentArrangementLength: describeLength(
          currentArrangement?.attributes.length
        ),
        requestedLength: describeLength(input.length),
      },
      serviceTypeId: input.serviceTypeId,
      planId: input.planId,
      itemId: input.itemId,
      attributes,
    };
  });

export const commitUpdatePlanItem = (
  prepared: PreparedUpdatePlanItem,
  planItemsService: Pick<PlanningCenterPlanItemsService, "updatePlanItem">,
  songsService: Pick<PlanningCenterSongsService, "getArrangement">
): Effect.Effect<PlanItem, PlanningCenterError> =>
  Effect.map(
    planItemsService
      .updatePlanItem(
        prepared.serviceTypeId,
        prepared.planId,
        prepared.itemId,
        prepared.attributes
      )
      .pipe(
        Effect.tapError((rejection) => {
          if (
            rejection._tag !== "PlanningCenterApiError" ||
            rejection.status !== 422
          ) {
            return Effect.void;
          }
          return Effect.gen(function* diagnoseRejectedUpdate() {
            const { songId, arrangementId } = prepared.diagnostics;
            const context = {
              serviceTypeId: prepared.serviceTypeId,
              planId: prepared.planId,
              itemId: prepared.itemId,
              ...prepared.diagnostics,
              sentLength: describeLength(prepared.attributes.length),
              selectedKeyId: isString(prepared.attributes.key_id)
                ? prepared.attributes.key_id
                : null,
              providerStatus: rejection.status,
            };
            yield* log.warn("Plan item update rejected", context);
            const rejectedLength = listedValidationErrors(rejection.details, [
              "length",
            ]).some((entry) => entry.attribute === "length");
            if (!rejectedLength || songId === null || arrangementId === null) {
              return;
            }
            // One uncached read on validation failure only. It shares the request budget and
            // pacing; a failed diagnostic must preserve the original mutation failure.
            yield* songsService.getArrangement(songId, arrangementId).pipe(
              Effect.matchEffect({
                onSuccess: (response) =>
                  log.warn("Rejected plan item arrangement duration", {
                    ...context,
                    selectedArrangementLength: describeLength(
                      response.data.attributes.length
                    ),
                  }),
                onFailure: (failure) =>
                  log.warn(
                    "Rejected plan item arrangement diagnostic unavailable",
                    {
                      ...context,
                      diagnosticFailure: failure._tag,
                    }
                  ),
              })
            );
          });
        })
      ),
    (response) => normalizePlanItem(response.data, response.included)
  );
