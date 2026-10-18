import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  analyticsPath,
  analyticsUrl,
  canInitializeAnalytics,
  canRecordSession,
  canReportException,
  prepareAnalyticsEvent,
  sanitizeAnalyticsProperties,
} from "./privacy";

describe("analytics privacy boundary", () => {
  it("permits already-masked replay frames only on authenticated product routes", () => {
    const event = {
      uuid: "replay-event",
      event: "$snapshot",
      properties: {
        $snapshot_data: [{ type: 2, data: { masked: true } }],
        $snapshot_bytes: 100,
        $session_id: "session",
        email: "private@example.com",
      },
    };
    for (const pathname of [
      "/",
      "/about",
      "/auth",
      "/demo/key",
      "/admin",
      "/other",
    ]) {
      expect(canRecordSession(pathname, true)).toBeFalsy();
      expect(prepareAnalyticsEvent(event, pathname, true)).toBeNull();
    }
    expect(prepareAnalyticsEvent(event, "/services", false)).toBeNull();
    expect(
      prepareAnalyticsEvent(event, "/people/123", true)?.properties
    ).toStrictEqual({
      $snapshot_data: event.properties.$snapshot_data,
      $snapshot_bytes: 100,
      $session_id: "session",
    });
  });

  it("sanitizes SDK top-level person attribution on identify", () => {
    const event = prepareAnalyticsEvent(
      {
        uuid: "test-event",
        event: "$identify",
        properties: { distinct_id: "user", $anon_distinct_id: "visitor" },
        $set: { email: "private@example.com" },
        $set_once: {
          $initial_referrer: "https://example.com/private?token=secret",
          $initial_current_url: "https://pcobooster.com/auth?code=secret",
        },
      },
      "/services",
      true
    );
    expect(event?.properties).toStrictEqual({
      distinct_id: "user",
      $anon_distinct_id: "visitor",
      surface: "app",
      is_authenticated: true,
    });
    expect(event?.$set).toStrictEqual({});
    expect(event?.$set_once).toStrictEqual({
      $initial_referrer: "https://example.com",
      $initial_current_url: "https://pcobooster.com/auth",
    });
  });

  it("drops demo, unauthenticated product, and unsolicited SDK events", () => {
    const event = { uuid: "test-event", event: "$pageview", properties: {} };
    expect(prepareAnalyticsEvent(event, "/demo/private-key", true)).toBeNull();
    expect(prepareAnalyticsEvent(event, "/services", false)).toBeNull();
    expect(
      prepareAnalyticsEvent({ ...event, event: "$snapshot" }, "/services", true)
    ).toBeNull();
    expect(
      prepareAnalyticsEvent({ ...event, event: "$autocapture" }, "/", false)
    ).toBeNull();
    expect(
      prepareAnalyticsEvent(
        { ...event, event: "$feature_flag_called" },
        "/",
        false
      )
    ).toBeNull();
  });

  it("reports exceptions only from authenticated product routes, with scrubbed frames", () => {
    const event = {
      uuid: "exception-event",
      event: "$exception",
      properties: {
        $session_id: "session",
        $exception_level: "error",
        $current_url: "https://pcobooster.com/people/123?q=secret",
        $exception_list: [
          {
            type: "TypeError",
            value: `Cannot read properties of undefined${"!".repeat(600)}`,
            mechanism: { handled: false, synthetic: false, type: "onerror" },
            stacktrace: {
              type: "raw",
              frames: [
                {
                  platform: "web:javascript",
                  filename: "https://pcobooster.com/assets/main-abc.js?v=1",
                  function: "render",
                  lineno: 1,
                  colno: 20,
                  in_app: true,
                  context_line: "const secret = person.name",
                },
                {
                  platform: "web:javascript",
                  filename: "https://pcobooster.com/people/123",
                  lineno: 2,
                  colno: 3,
                },
              ],
            },
          },
        ],
      },
    };
    for (const pathname of ["/", "/auth", "/demo/key", "/other"]) {
      expect(prepareAnalyticsEvent(event, pathname, true)).toBeNull();
    }
    expect(prepareAnalyticsEvent(event, "/services", false)).toBeNull();
    expect(
      prepareAnalyticsEvent(
        { ...event, properties: { $exception_list: "not a list" } },
        "/services",
        true
      )
    ).toBeNull();

    const prepared = prepareAnalyticsEvent(event, "/people/123", true);
    const [exception] = Schema.decodeUnknownSync(
      Schema.Array(
        Schema.Struct({ value: Schema.String, stacktrace: Schema.Unknown })
      )
    )(prepared?.properties.$exception_list);
    expect(exception?.value).toHaveLength(500);
    expect(exception?.stacktrace).toStrictEqual({
      type: "raw",
      frames: [
        {
          platform: "web:javascript",
          filename: "https://pcobooster.com/assets/main-abc.js",
          function: "render",
          lineno: 1,
          colno: 20,
          in_app: true,
        },
        {
          platform: "web:javascript",
          filename: "https://pcobooster.com/people/:personId",
          lineno: 2,
          colno: 3,
        },
      ],
    });
    expect(prepared?.properties).toMatchObject({
      $session_id: "session",
      $exception_level: "error",
      $current_url: "https://pcobooster.com/people/:personId",
      surface: "app",
    });
  });

  it("keeps an exception when a frame line number is null or not finite", () => {
    const event = {
      uuid: "null-line",
      event: "$exception",
      properties: {
        $exception_list: [
          {
            type: "Error",
            value: "Menu group missing",
            stacktrace: {
              type: "raw",
              frames: [
                {
                  filename: "https://pcobooster.com/assets/editor.js",
                  function: "InsertMenu",
                  lineno: null,
                  colno: null,
                },
                {
                  filename: "https://pcobooster.com/assets/editor.js",
                  function: "openMenu",
                  lineno: "12",
                  colno: Number.NaN,
                },
              ],
            },
          },
        ],
      },
    };

    expect(
      prepareAnalyticsEvent(event, "/songs/42", true)?.properties
        .$exception_list
    ).toStrictEqual([
      {
        type: "Error",
        value: "Menu group missing",
        stacktrace: {
          type: "raw",
          frames: [
            {
              filename: "https://pcobooster.com/assets/editor.js",
              function: "InsertMenu",
            },
            {
              filename: "https://pcobooster.com/assets/editor.js",
              function: "openMenu",
            },
          ],
        },
      },
    ]);
  });

  it("keeps type and message when the exception list still cannot decode", () => {
    const message = `Base UI error #31${"!".repeat(600)}`;
    const event = {
      uuid: "undecodable",
      event: "$exception",
      properties: {
        $exception_list: [
          {
            type: "Error",
            value: message,
            stacktrace: { type: 1, frames: [] },
          },
        ],
      },
    };

    expect(
      prepareAnalyticsEvent(event, "/songs/42", true)?.properties
        .$exception_list
    ).toStrictEqual([
      {
        type: "Error",
        value: message.slice(0, 500),
        stacktrace: undefined,
      },
    ]);
    expect(
      prepareAnalyticsEvent(
        {
          uuid: "no-text",
          event: "$exception",
          properties: { $exception_list: [{ value: 31 }] },
        },
        "/songs/42",
        true
      )
    ).toBeNull();
  });

  it("keeps handled read failures on Overview and Songs linked to the person and session", () => {
    const event = {
      uuid: "read-failure",
      event: "$exception",
      properties: {
        distinct_id: "app-user",
        $session_id: "session",
        operation: "plan-items",
        error_code: "BAD_GATEWAY",
        outcome: "read_failed",
        $exception_list: [
          {
            type: "DataLoadError",
            value: "Failed to load plan-items (BAD_GATEWAY)",
          },
        ],
        queryKey: ["plan-items", "private-plan"],
      },
    };
    for (const pathname of [
      "/services/123/plans/456/overview",
      "/songs/123",
      "/songs",
    ]) {
      expect(canReportException(pathname, true)).toBeTruthy();
      expect(
        prepareAnalyticsEvent(event, pathname, true)?.properties
      ).toStrictEqual({
        distinct_id: "app-user",
        $session_id: "session",
        operation: "plan-items",
        error_code: "BAD_GATEWAY",
        outcome: "read_failed",
        $exception_list: event.properties.$exception_list.map((exception) => ({
          ...exception,
          stacktrace: undefined,
        })),
        surface: "app",
        is_authenticated: true,
      });
    }
    expect(canReportException("/demo/private", true)).toBeFalsy();
    expect(canReportException("/services", false)).toBeFalsy();
  });

  it("collapses provider IDs while preserving the feature being used", () => {
    expect(analyticsPath("/services/123/plans/456/lineup")).toBe(
      "/services/:serviceTypeId/plans/:planId/lineup"
    );
    expect(analyticsPath("/services/123/plans/456")).toBe(
      "/services/:serviceTypeId/plans/:planId/assign"
    );
    expect(analyticsPath("/people/987")).toBe("/people/:personId");
    expect(analyticsPath("/demo/private-key")).toBe("/other");
    expect(analyticsPath("/admin/users/private-id")).toBe("/other");
  });

  it("preserves Overview and Songs error locations without IDs or expanding replay", () => {
    expect(analyticsPath("/services/123/plans/456/overview")).toBe(
      "/services/:serviceTypeId/plans/:planId/overview"
    );
    expect(analyticsPath("/songs/private-song")).toBe("/songs/:songId");
    expect(
      canRecordSession("/services/123/plans/456/overview", true)
    ).toBeFalsy();
    expect(canRecordSession("/songs/private-song", true)).toBeFalsy();
  });

  it.each([
    ["/key-transitions/", "/key-transitions"],
    ["/key-transitions/e-to-e-flat/", "/key-transitions/e-to-e-flat"],
  ])("keeps signed-out pageviews on %s as marketing", (pathname, path) => {
    const event = prepareAnalyticsEvent(
      {
        uuid: "pageview",
        event: "$pageview",
        properties: {
          distinct_id: "visitor",
          $current_url: `https://pcobooster.com${pathname}?from=G`,
        },
      },
      pathname,
      false
    );
    expect(analyticsPath(pathname)).toBe(path);
    expect(event?.properties).toStrictEqual({
      distinct_id: "visitor",
      $current_url: `https://pcobooster.com${path}`,
      is_authenticated: false,
      surface: "marketing",
    });
  });

  it("removes query strings, fragments, and external referrer paths", () => {
    expect(
      analyticsUrl(
        "https://pcobooster.com/auth?code=secret&returnTo=/people/123#token"
      )
    ).toBe("https://pcobooster.com/auth");
    expect(
      analyticsUrl(
        "https://login.planningcenteronline.com/private?email=person@example.com"
      )
    ).toBe("https://login.planningcenteronline.com");
    expect(analyticsUrl("not a URL")).toBe("");
  });

  it("sanitizes nested attribution and drops unspecified payloads", () => {
    expect(
      sanitizeAnalyticsProperties({
        distinct_id: "app-user-id",
        $current_url: "https://pcobooster.com/people/123?name=secret",
        $set: {
          email: "private@example.com",
          $initial_current_url: "https://pcobooster.com/demo/private-key",
          $initial_utm_source: "newsletter",
        },
        $set_once: {
          name: "Private person",
          $initial_referrer: "https://example.com/private?token=secret",
        },
        operation: "schedule.assign",
        response: { person: "Private person" },
        $title: "Private plan title",
        $exception_message: "Private payload",
      })
    ).toStrictEqual({
      distinct_id: "app-user-id",
      $current_url: "https://pcobooster.com/people/:personId",
      $set: {
        $initial_current_url: "https://pcobooster.com/other",
        $initial_utm_source: "newsletter",
      },
      $set_once: { $initial_referrer: "https://example.com" },
      operation: "schedule.assign",
    });
  });

  it("keeps local, preview, and unconfigured environments out of production", () => {
    expect(canInitializeAnalytics("key", "pcobooster.com", true)).toBeTruthy();
    expect(
      canInitializeAnalytics(
        "key",
        "pcobooster-pr-1-web.jakebodea.workers.dev",
        true
      )
    ).toBeFalsy();
    expect(canInitializeAnalytics("key", "127.0.0.1", true)).toBeFalsy();
    expect(canInitializeAnalytics("key", "pcobooster.com", false)).toBeFalsy();
    expect(
      canInitializeAnalytics(undefined, "pcobooster.com", true)
    ).toBeFalsy();
  });
});
