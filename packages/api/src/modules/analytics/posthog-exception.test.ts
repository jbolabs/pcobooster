import {
  createPostHogExceptionReporter,
  toPostHogExceptionCapture,
} from "@pcobooster/api/modules/analytics/posthog-exception";
import { ExternalServiceFailure } from "@pcobooster/contracts/faults/external-service-failure";
import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-09-28T17:00:00.000Z");
const request = {
  code: "BAD_GATEWAY",
  path: "/api/v1/service-types/:serviceTypeId/plans/:planId/items",
  method: "POST",
  requestId: "request-1",
  procedure: "items.create",
};

const planningCenterFailure = (): ExternalServiceFailure => {
  const cause = new Error("Planning Center responded 503");
  cause.stack = [
    "Error: Planning Center responded 503",
    "    at createPlanItem (index.js:10:5)",
    "    at async run (index.js:20:7)",
  ].join("\n");
  return new ExternalServiceFailure({
    message: "Planning Center is unavailable",
    service: "planning-center",
    cause,
  });
};

describe(toPostHogExceptionCapture, () => {
  it("describes the root cause and groups by procedure and error code", () => {
    expect(
      toPostHogExceptionCapture(
        "key",
        { ...request, error: planningCenterFailure() },
        NOW
      )
    ).toStrictEqual({
      api_key: "key",
      event: "$exception",
      distinct_id: "pcobooster-api",
      timestamp: "2026-09-28T17:00:00.000Z",
      properties: {
        source: "server",
        $process_person_profile: false,
        $exception_level: "error",
        $exception_list: [
          {
            type: "Error",
            value: "Planning Center responded 503",
            mechanism: { handled: true, synthetic: false, type: "rpc" },
            stacktrace: {
              type: "raw",
              frames: [
                {
                  platform: "node:javascript",
                  filename: "index.js",
                  function: "async run",
                  lineno: 20,
                  colno: 7,
                  in_app: true,
                },
                {
                  platform: "node:javascript",
                  filename: "index.js",
                  function: "createPlanItem",
                  lineno: 10,
                  colno: 5,
                  in_app: true,
                },
              ],
            },
          },
        ],
        $exception_fingerprint:
          "api:/api/v1/service-types/:serviceTypeId/plans/:planId/items:BAD_GATEWAY",
        error_code: "BAD_GATEWAY",
        path: "/api/v1/service-types/:serviceTypeId/plans/:planId/items",
        method: "POST",
        request_id: "request-1",
        procedure: "items.create",
        operation: "items.create",
      },
    });
  });

  it("groups defects as unhandled and describes the defect itself", () => {
    const capture = toPostHogExceptionCapture(
      "key",
      { ...request, code: "UNHANDLED", error: new TypeError("plain defect") },
      NOW
    );
    expect(capture.properties).toMatchObject({
      $exception_fingerprint:
        "api:/api/v1/service-types/:serviceTypeId/plans/:planId/items:UNHANDLED",
      $exception_list: [{ type: "TypeError", value: "plain defect" }],
    });
  });
});

describe(createPostHogExceptionReporter, () => {
  it("is disabled without a project key", () => {
    const send = vi.fn<typeof globalThis.fetch>();
    expect(
      createPostHogExceptionReporter({ apiKey: null, fetch: send })
    ).toBeNull();
    expect(
      createPostHogExceptionReporter({ apiKey: "", fetch: send })
    ).toBeNull();
  });

  it("sends each reported failure to PostHog", async () => {
    const send = vi.fn<typeof globalThis.fetch>(
      async () => await Promise.resolve(new Response(null, { status: 200 }))
    );
    const report = createPostHogExceptionReporter({
      apiKey: "key",
      fetch: send,
      now: () => NOW,
    });

    await report?.({ ...request, error: planningCenterFailure() });

    expect(send).toHaveBeenCalledOnce();
    const body = Schema.decodeUnknownSync(
      Schema.fromJsonString(Schema.Struct({ event: Schema.String }))
    )(send.mock.calls[0]?.[1]?.body);
    expect(body.event).toBe("$exception");
  });

  it("surfaces PostHog rejections to the caller", async () => {
    const report = createPostHogExceptionReporter({
      apiKey: "key",
      fetch: async () =>
        await Promise.resolve(new Response(null, { status: 400 })),
    });
    await expect(
      report?.({ ...request, error: new Error("defect") })
    ).rejects.toThrow("PostHog capture failed with status 400");
  });
});
