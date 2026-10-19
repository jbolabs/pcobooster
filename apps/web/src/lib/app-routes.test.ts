import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import {
  assertPlanView,
  getAppSection,
  parseDetailRoute,
  parsePlanRoute,
  phonePlanViews,
  phonePlanViewTab,
  planViewEnabled,
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
      "practice",
    ]);
    expect(phonePlanViewTab("assign")).toBe("lineup");
    expect(phonePlanViewTab("times")).toBe("times");
  });
});

describe(planViewEnabled, () => {
  const flags = { people: true, chordCharts: true };

  it("shows Practice only where its flag is on, and hides it until the flags answer", () => {
    expect(
      planViewEnabled("practice", { ...flags, practice: true })
    ).toBeTruthy();
    expect(
      planViewEnabled("practice", { ...flags, practice: false })
    ).toBeFalsy();
    expect(planViewEnabled("practice")).toBeFalsy();
  });

  it("always shows views without a flag", () => {
    expect(planViewEnabled("plan")).toBeTruthy();
    expect(
      planViewEnabled("lineup", { ...flags, practice: false })
    ).toBeTruthy();
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
      songSubpage: null,
    });
    expect(parseDetailRoute("/people")).toBeNull();
    expect(parseDetailRoute("/songs/12")).toStrictEqual({
      parentHref: "/songs",
      parentLabel: "Songs",
      label: "Song",
      personId: null,
      songId: "12",
      songSubpage: null,
    });
    expect(parseDetailRoute("/songs/12/chart")).toMatchObject({
      songId: "12",
      songSubpage: { songId: "12", label: "Chart" },
    });
    expect(parseDetailRoute("/songs")).toBeNull();
  });
});
