import type { captureAnalytics } from "@pcobooster/analytics/client";
import { TransportFailure } from "@pcobooster/client/product-client";
import { InvalidInput } from "@pcobooster/contracts/faults/invalid-input";
import { PositionMismatch } from "@pcobooster/contracts/faults/position-mismatch";
import { describe, expect, it, vi } from "vitest";

import { measureWorkflow } from "./workflow-analytics";

describe("workflow analytics", () => {
  it("records success only after the real operation resolves and preserves its result", async () => {
    const capture = vi.fn<typeof captureAnalytics>();
    const result = await measureWorkflow(async (named) => {
      named("schedule.assign");
      expect(capture).not.toHaveBeenCalled();
      return await Promise.resolve("saved");
    }, capture);
    expect(result).toBe("saved");
    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0]?.[0]).toBe("workflow completed");
    expect(capture.mock.calls[0]?.[1]?.operation).toBe("schedule.assign");
    expect(capture.mock.calls[0]?.[1]?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("records a bounded error code, never a provider message, and rethrows the same error", async () => {
    const capture = vi.fn<typeof captureAnalytics>();
    const error = new PositionMismatch({
      message: "Private person and plan details",
      details: {
        selected: {
          teamId: "team-1",
          teamName: "Band",
          positionId: "position-1",
          positionName: "Keys",
        },
        created: { planPersonId: "plan-person-1", teamPositionName: "Piano" },
      },
    });
    await expect(
      measureWorkflow(async (named) => {
        named("schedule.assign");
        return await Promise.reject(error);
      }, capture)
    ).rejects.toBe(error);
    expect(capture).toHaveBeenCalledExactlyOnceWith("workflow failed", {
      operation: "schedule.assign",
      error_code: "POSITION_MISMATCH",
    });
  });

  it("does not count reads as writes and reports rejected write cancellations", async () => {
    const capture = vi.fn<typeof captureAnalytics>();
    await measureWorkflow(async (named) => {
      named("people.list");
      return await Promise.resolve("data");
    }, capture);
    const error = new Error("Aborted", { cause: "navigation" });
    error.name = "AbortError";
    await expect(
      measureWorkflow(async (named) => {
        named("planItems.update");
        return await Promise.reject(error);
      }, capture)
    ).rejects.toBe(error);
    expect(capture).toHaveBeenCalledExactlyOnceWith("workflow failed", {
      operation: "planItems.update",
      error_code: "UNKNOWN",
    });
  });

  it("reports a write that never reached the API as a network error", async () => {
    const capture = vi.fn<typeof captureAnalytics>();
    const error = new TransportFailure({
      procedure: "schedule.assign",
      reason: "network",
      cause: null,
    });

    await expect(
      measureWorkflow(async (named) => {
        named("schedule.assign");
        return await Promise.reject(error);
      }, capture)
    ).rejects.toBe(error);

    expect(capture).toHaveBeenCalledExactlyOnceWith("workflow failed", {
      operation: "schedule.assign",
      error_code: "NETWORK_ERROR",
    });
  });
});

describe("length validation regression", () => {
  it("records safe Planning Center validation detail on workflow failure", async () => {
    const capture = vi.fn<typeof captureAnalytics>();
    const error = new InvalidInput({
      message: "private title",
      planningCenterValidation: {
        code: "too_long",
        detail: "can not be longer than 24 hours",
        field: "length",
      },
    });
    await expect(
      measureWorkflow(async (named) => {
        named("planItems.update");
        return await Promise.reject(error);
      }, capture)
    ).rejects.toBe(error);
    expect(capture.mock.calls[0]).toStrictEqual([
      "workflow failed",
      {
        operation: "planItems.update",
        error_code: "BAD_REQUEST",
        pco_validation_code: "too_long",
        pco_validation_detail: "can not be longer than 24 hours",
        pco_validation_field: "length",
      },
    ]);
  });
});
