import { describe, expect, it } from "vitest";

import { personalServiceRows } from "./personal-service-rows";

const assignments = [
  {
    planId: "christmas",
    serviceTypeId: "archived",
    serviceTypeName: "Christmas",
    sortDate: new Date("2024-12-25T19:00:00Z"),
    assignment: "Band · Bass",
  },
  {
    planId: "christmas",
    serviceTypeId: "archived",
    serviceTypeName: "Christmas",
    sortDate: new Date("2024-12-25T19:00:00Z"),
    assignment: "Tech · Lighting",
  },
  {
    planId: "sunday",
    serviceTypeId: "weekly",
    serviceTypeName: "Sunday",
    sortDate: new Date("2024-12-22T19:00:00Z"),
    assignment: "Band · Bass",
  },
];

describe("personal service rows", () => {
  it("keeps archived service types and merges assignments from different pages into one searchable plan", () => {
    expect(
      personalServiceRows(assignments, null).map((row) => [
        row.planId,
        row.planTitle,
      ])
    ).toStrictEqual([
      ["christmas", "Band · Bass; Tech · Lighting"],
      ["sunday", "Band · Bass"],
    ]);
  });

  it("honors an explicit service type selection", () => {
    expect(
      personalServiceRows(assignments, ["weekly"]).map((row) => row.planId)
    ).toStrictEqual(["sunday"]);
  });
});
