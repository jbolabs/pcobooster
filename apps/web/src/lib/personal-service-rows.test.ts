import { describe, expect, it } from "vitest";

import { personalServiceRows } from "./personal-service-rows";

const assignments = [
  {
    planId: "christmas",
    serviceTypeId: "archived",
    serviceTypeName: "Christmas",
    sortDate: new Date("2027-12-25T19:00:00Z"),
    assignment: "Band · Bass",
  },
  {
    planId: "christmas",
    serviceTypeId: "archived",
    serviceTypeName: "Christmas",
    sortDate: new Date("2027-12-25T19:00:00Z"),
    assignment: "Tech · Lighting",
  },
  {
    planId: "sunday",
    serviceTypeId: "weekly",
    serviceTypeName: "Sunday",
    sortDate: new Date("2027-12-22T19:00:00Z"),
    assignment: "Band · Bass",
  },
];

describe("personal service rows", () => {
  it("keeps assigned service types and merges assignments from different pages into one card", () => {
    expect(
      personalServiceRows(assignments).map((row) => [row.planId, row.planTitle])
    ).toStrictEqual([
      ["sunday", "Band · Bass"],
      ["christmas", "Band · Bass; Tech · Lighting"],
    ]);
  });

  it("orders displayed plan dates even when provider schedule times arrive in another order", () => {
    expect(
      personalServiceRows(assignments).map((row) => row.planId)
    ).toStrictEqual(["sunday", "christmas"]);
  });

  it("keeps more than three assigned plans beyond the agenda window", () => {
    const rows = personalServiceRows([
      ...assignments,
      {
        planId: "newyear",
        serviceTypeId: "weekly",
        serviceTypeName: "Sunday",
        sortDate: new Date("2028-01-01T19:00:00Z"),
        assignment: "Band · Bass",
      },
      {
        planId: "february",
        serviceTypeId: "weekly",
        serviceTypeName: "Sunday",
        sortDate: new Date("2028-02-01T19:00:00Z"),
        assignment: "Band · Bass",
      },
    ]);
    expect(rows.map((row) => row.planId)).toStrictEqual([
      "sunday",
      "christmas",
      "newyear",
      "february",
    ]);
  });
});
