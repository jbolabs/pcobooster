import type { PlanView } from "@pcobooster/planning-center-models/plan-overview";
import { notFound } from "@tanstack/react-router";

export const planViews: readonly PlanView[] = [
  "overview",
  "assign",
  "lineup",
  "plan",
  "times",
  "practice",
];

/**
 * Phones fold Assign into Lineup, as the iOS app does: Lineup is the position list there,
 * and Assign only opens for one position's candidates.
 */
export const phonePlanViews: readonly PlanView[] = planViews.filter(
  (view) => view !== "assign"
);

/** The phone tab a view lives under. */
export const phonePlanViewTab = (view: PlanView): PlanView =>
  view === "assign" ? "lineup" : view;

const planViewLabels: Record<PlanView, string> = {
  overview: "Overview",
  assign: "Assign",
  lineup: "Lineup",
  plan: "Plan",
  times: "Times",
  practice: "Practice",
};

export const getPlanViewLabel = (view: PlanView): string =>
  planViewLabels[view];

export const isPlanView = (value: string): value is PlanView =>
  planViews.some((view) => view === value);

type AssertPlanView = (value: string) => asserts value is PlanView;

/** Unknown views render the not-found page, as the route never existed. */
export const assertPlanView: AssertPlanView = (value) => {
  if (!isPlanView(value)) {
    notFound({ throw: true });
  }
};

export interface PlanRoute {
  serviceTypeId: string;
  planId: string;
  view: PlanView;
}

const planRoutePattern =
  /^\/services\/(?<serviceTypeId>[^/]+)\/plans\/(?<planId>[^/]+)\/(?<view>[^/]+)$/u;

const decodeSegment = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/** Reads a plan workspace path, such as a `planUrl` from the API, into route params. */
export const parsePlanRoute = (pathname: string): PlanRoute | null => {
  const match = planRoutePattern.exec(pathname);
  if (!match) {
    return null;
  }
  const [, encodedServiceTypeId, encodedPlanId, view] = match;
  const serviceTypeId = decodeSegment(encodedServiceTypeId);
  const planId = decodeSegment(encodedPlanId);
  if (serviceTypeId === null || planId === null || !isPlanView(view)) {
    return null;
  }
  return { serviceTypeId, planId, view };
};

export type AppSection = "services" | "people" | "songs";

export const getAppSection = (pathname: string): AppSection => {
  if (pathname.startsWith("/people")) {
    return "people";
  }
  if (pathname.startsWith("/songs")) {
    return "songs";
  }
  return "services";
};

const appSectionLabels: Record<AppSection, string> = {
  services: "Services",
  people: "People",
  songs: "Songs",
};

export const getAppSectionLabel = (section: AppSection): string =>
  appSectionLabels[section];

export interface DetailRoute {
  parentHref: "/people" | "/songs";
  parentLabel: string;
  /** The page's label until something better (such as a person's name) is known. */
  label: string;
  /** The person a People detail page shows, so the breadcrumb can name them. */
  personId: string | null;
  /** The song a Songs detail page shows, so the breadcrumb can name it. */
  songId: string | null;
}

const personDetailPattern = /^\/people\/(?<personId>[^/]+)/u;
const songDetailPattern = /^\/songs\/(?<songId>[^/]+)/u;

/** Detail pages that sit one level under a top-level section. */
export const parseDetailRoute = (pathname: string): DetailRoute | null => {
  const personMatch = personDetailPattern.exec(pathname);
  const encodedPersonId = personMatch?.groups?.personId;
  if (encodedPersonId !== undefined) {
    return {
      parentHref: "/people",
      parentLabel: "People",
      label: "Person",
      personId: decodeSegment(encodedPersonId),
      songId: null,
    };
  }
  const encodedSongId = songDetailPattern.exec(pathname)?.groups?.songId;
  if (encodedSongId !== undefined) {
    return {
      parentHref: "/songs",
      parentLabel: "Songs",
      label: "Song",
      personId: null,
      songId: decodeSegment(encodedSongId),
    };
  }
  return null;
};
