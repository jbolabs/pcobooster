import { hasServicesLevel } from "@pcobooster/planning-center-models/access";
import type { PlanningCenterAccessSnapshot } from "@pcobooster/planning-center-models/access";

/**
 * Whether the person may edit chord charts: `pending` while their permissions load and
 * `unavailable` when they couldn't be read, so nobody sees Edit before it is known they may
 * use it.
 */
export type ChordChartEditAccess =
  | "pending"
  | "unavailable"
  | "editor"
  | "viewer";

/**
 * Only a known song permission below Editor (or the read-only demo) makes charts view-only.
 * When Planning Center doesn't report a song level, editing stays open and Planning Center
 * has the final say; a failed permissions read grants nothing.
 */
export const chordChartEditAccess = (
  snapshot: PlanningCenterAccessSnapshot | null,
  demo: boolean,
  readFailed: boolean
): ChordChartEditAccess => {
  if (demo) {
    return "viewer";
  }
  if (snapshot === null) {
    return readFailed ? "unavailable" : "pending";
  }
  const { services } = snapshot;
  if (services.status === "none") {
    return "viewer";
  }
  if (
    services.organizationAdministrator ||
    services.songLevel === null ||
    hasServicesLevel(services.songLevel, "Editor")
  ) {
    return "editor";
  }
  return "viewer";
};
