import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import {
  assertPlanView,
  getAppSection,
  parseDetailRoute,
  parsePlanRoute,
  phonePlanViews,
  phonePlanViewTab,
} from "@/lib/app-routes";

describe(parsePlanRoute, () => {
  it("reads the plan workspace path", () => {
    expect(parsePlanRoute("/services/12/plans/34/lineup")).toStrictEqual({
      serviceTypeId: "12",
      planId: "34",
      view: "lineup",
    });
  });

  it("decodes path segments into route params", () => {
    expect(parsePlanRoute("/services/a%2Fb/plans/34/assign")).toStrictEqual({
      serviceTypeId: "a/b",
      planId: "34",
      view: "assign",
    });
    expect(parsePlanRoute("/services/%E0%A4%A/plans/34/assign")).toBeNull();
  });

  it("rejects unknown views and other routes", () => {
    expect(parsePlanRoute("/services/12/plans/34/unknown")).toBeNull();
    expect(parsePlanRoute("/services")).toBeNull();
    expect(parsePlanRoute("/services/12/plans/34")).toBeNull();
  });
});

describe(assertPlanView, () => {
  it("accepts every plan view and renders not-found for unknown views", () => {
    for (const view of ["overview", "assign", "lineup", "plan", "times"]) {
      expect(() => {
        assertPlanView(view);
      }).not.toThrow();
    }
    expect(() => {
      assertPlanView("unknown");
    }).toThrow(expect.toSatisfy(isNotFound));
  });
});

describe("phone plan tabs", () => {
  it("fold Assign into Lineup, as the iOS app does", () => {
    expect(phonePlanViews).toStrictEqual([
      "overview",
      "lineup",
      "plan",
      "times",
    ]);
    expect(phonePlanViewTab("assign")).toBe("lineup");
    expect(phonePlanViewTab("times")).toBe("times");
  });
});

describe("app sections", () => {
  it("maps paths to their top-level section", () => {
    expect(getAppSection("/people")).toBe("people");
    expect(getAppSection("/songs/12")).toBe("songs");
    expect(getAppSection("/services/1/plans/2/assign")).toBe("services");
  });

  it("describes detail routes with their parent", () => {
    expect(parseDetailRoute("/people/99")).toStrictEqual({
      parentHref: "/people",
      parentLabel: "People",
      label: "Person",
      personId: "99",
      songId: null,
    });
    expect(parseDetailRoute("/people")).toBeNull();
    expect(parseDetailRoute("/songs/12")).toStrictEqual({
      parentHref: "/songs",
      parentLabel: "Songs",
      label: "Song",
      personId: null,
      songId: "12",
    });
    expect(parseDetailRoute("/songs/12/chart")?.songId).toBe("12");
    expect(parseDetailRoute("/songs")).toBeNull();
  });
});
