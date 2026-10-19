import type { PlanningCenterAccessSnapshot } from "@pcobooster/planning-center-models/access";
import { describe, expect, it } from "vitest";

import { chordChartEditAccess } from "@/lib/chord-chart-access";

const snapshot = (
  songLevel: "Viewer" | "Editor" | null,
  organizationAdministrator = false
): PlanningCenterAccessSnapshot => ({
  services: {
    status: "granted",
    organizationAdministrator,
    planLevel: "Editor",
    maxPlanLevel: "Editor",
    songLevel,
    canViewAllPeople: true,
    ledTeamCount: 0,
    serviceTypes: [],
  },
  people: { status: "granted" },
});

describe(chordChartEditAccess, () => {
  it("lets song Editors and organization administrators edit", () => {
    expect([
      chordChartEditAccess(snapshot("Editor"), false, false),
      chordChartEditAccess(snapshot("Viewer", true), false, false),
    ]).toStrictEqual(["editor", "editor"]);
  });

  it("makes charts view-only for song Viewers and the read-only demo", () => {
    expect([
      chordChartEditAccess(snapshot("Viewer"), false, false),
      chordChartEditAccess(snapshot("Editor"), true, false),
      chordChartEditAccess(null, true, false),
    ]).toStrictEqual(["viewer", "viewer", "viewer"]);
  });

  it("waits while permissions load, and leaves an unreported level or a failed read open", () => {
    expect([
      chordChartEditAccess(null, false, false),
      chordChartEditAccess(snapshot(null), false, false),
      chordChartEditAccess(null, false, true),
    ]).toStrictEqual(["pending", "editor", "editor"]);
  });
});
