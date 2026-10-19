import type { captureAnalytics } from "@pcobooster/analytics/client";
import { failureCode } from "@pcobooster/client/product-client";
import { InvalidInput } from "@pcobooster/contracts/faults/invalid-input";
import { Option, Schema } from "effect";

const OPERATIONS = new Set([
  "schedule.assign",
  "schedule.remove",
  "schedule.updateStatus",
  "planItems.create",
  "planItems.update",
  "planItems.delete",
  "planItems.reorder",
  "planTimes.create",
  "planTimes.update",
  "planTimes.delete",
  "accounts.select",
  "neededPositions.adjust",
  "planPeople.updateTimes",
  "chordCharts.update",
  "chordCharts.create",
  "chordCharts.createSong",
  "feedback.submit",
]);
const decodeErrorCode = Schema.decodeUnknownOption(
  Schema.Literals([
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "BAD_REQUEST",
    "ALREADY_SCHEDULED",
    "POSITION_MISMATCH",
    "CONFLICT",
    "SERVICE_UNAVAILABLE",
    "NETWORK_ERROR",
    "GATEWAY_TIMEOUT",
    "TOO_MANY_REQUESTS",
    "BAD_GATEWAY",
    "INTERNAL_SERVER_ERROR",
    "CLIENT_OUTDATED",
  ])
);

interface WorkflowFailureProperties {
  operation: string;
  error_code: string;
  [key: string]: string;
}

/**
 * Measures a call whose operation (`schedule.assign`) the call itself names once its request
 * is sent (`named`), as the product client reports it from the route table. Only the selected
 * writes are captured, and only operation names and outcomes, never request or response bodies
 * or arbitrary error messages. Known Planning Center validation phrases are allowlisted.
 */
export const measureWorkflow = async <T>(
  execute: (named: (operation: string) => void) => Promise<T>,
  capture: typeof captureAnalytics
): Promise<T> => {
  let operation: string | undefined;
  const start = performance.now();
  const measured = () =>
    operation !== undefined && OPERATIONS.has(operation)
      ? operation
      : undefined;
  try {
    const result = await execute((name) => {
      operation = name;
    });
    const completed = measured();
    if (completed !== undefined) {
      capture("workflow completed", {
        operation: completed,
        duration_ms: Math.round(performance.now() - start),
      });
    }
    return result;
  } catch (error) {
    const failed = measured();
    if (failed !== undefined) {
      const errorCode = decodeErrorCode(
        error instanceof Error ? failureCode(error) : undefined
      );
      const validation =
        error instanceof InvalidInput
          ? error.planningCenterValidation
          : undefined;
      const properties: WorkflowFailureProperties = {
        operation: failed,
        error_code: Option.getOrElse(errorCode, () => "UNKNOWN"),
      };
      if (validation) {
        properties.pco_validation_detail = validation.detail;
        properties.pco_validation_field = validation.field;
        if (validation.code) {
          properties.pco_validation_code = validation.code;
        }
      }
      capture("workflow failed", properties);
    }
    throw error;
  }
};
