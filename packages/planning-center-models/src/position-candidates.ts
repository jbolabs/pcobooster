import { summarizeCandidateHistory } from "@pcobooster/planning-center-models/candidate-frequency";
import {
  scoreAndNormalizePeople,
  sortPeopleForSelection,
} from "@pcobooster/planning-center-models/candidate-scoring";
import type { SchedulingPreferences } from "@pcobooster/planning-center-models/scheduling-preferences";
import type {
  PersonWithAvailability,
  ServiceHistoryItem,
} from "@pcobooster/planning-center-models/types";

/**
 * How a scheduler's candidate list is built from its progressive parts: candidates (with the
 * selected plan's fresh roster), plan-window history, and per-candidate availability. The API
 * returns the parts; the browser assembles them with `assemblePositionCandidates`.
 */

/** The selected plan and slot that candidates are matched against. */
export interface SelectedPlanMatchContext {
  planId?: string;
  teamId?: string;
  selectedPositionName?: string;
  selectedTeamName?: string;
}

export type SelectedPlanRosterStatus = "confirmed" | "pending" | "declined";

/** A person's roster entry for the selected slot on the selected plan. */
export interface SelectedPlanSlot {
  planPersonId: string;
  status: SelectedPlanRosterStatus;
  declineReason: string | null;
}

/** A candidate for a position, with the selected plan's fresh roster applied. */
export interface PositionCandidate {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  photoUrl: string | null;
  photoThumbnailUrl: string | null;
  archived: boolean;
  /** Labels of the person's non-declined roster entries on the selected plan. */
  selectedPlanRosterLabels: string[];
  selectedPlanSlot: SelectedPlanSlot | null;
  /** Null for people on the selected slot who are not assigned to the position. */
  schedulingPreferences: SchedulingPreferences | null;
}

/**
 * One of a person's assignments on the selected plan, as history saw it: a roster row
 * (`planPerson`) from the plan window, or one of the person's own schedules (`schedule`).
 */
export interface SelectedPlanAssignment {
  source: "planPerson" | "schedule";
  id: string;
  planId: string | null;
  teamId: string | null;
  /** A schedule's own `team_name`; roster rows name the team only in the position name. */
  teamName: string | null;
  teamPositionName: string;
  status: string;
  /** A schedule's plan person; roster rows are plan people themselves. */
  planPersonId: string | null;
  /** Trimmed `decline_reason`, or null when empty. */
  declineReason: string | null;
}

/** A candidate's history rows (unsorted) and their selected-plan assignments. */
export interface CandidateHistory {
  serviceHistory: ServiceHistoryItem[];
  selectedPlanAssignments: SelectedPlanAssignment[];
}

export const EMPTY_CANDIDATE_HISTORY: CandidateHistory = {
  serviceHistory: [],
  selectedPlanAssignments: [],
};

const createCandidatePerson = (
  candidate: PositionCandidate
): PersonWithAvailability => ({
  id: candidate.id,
  firstName: candidate.firstName,
  lastName: candidate.lastName,
  fullName: candidate.fullName,
  photoUrl: candidate.photoUrl,
  photoThumbnailUrl: candidate.photoThumbnailUrl,
  archived: candidate.archived,
  positions: [],
  isScheduledForSelectedPlanPosition: false,
  isConfirmedForSelectedPlanPosition: false,
  isDeclinedForSelectedPlanPosition: false,
  selectedPlanAssignmentLabels: [],
  schedulingPreferences: candidate.schedulingPreferences,
});

const applySelectedSlot = (
  person: PersonWithAvailability,
  slot: SelectedPlanSlot | null,
  labels: string[]
) => {
  person.selectedPlanAssignmentLabels = labels;
  person.selectedPlanDeclineReason = undefined;
  if (slot === null) {
    return;
  }
  person.isScheduledForSelectedPlanPosition = true;
  person.isConfirmedForSelectedPlanPosition = slot.status === "confirmed";
  person.isDeclinedForSelectedPlanPosition = slot.status === "declined";
  person.scheduledPlanPersonId = slot.planPersonId;
  if (person.isDeclinedForSelectedPlanPosition) {
    person.selectedPlanDeclineReason = slot.declineReason;
  }
};

export interface PositionCandidateSources {
  candidates: readonly PositionCandidate[];
  match: SelectedPlanMatchContext;
  /** The selected plan's sort instant. */
  referenceDate: Date;
  /** The organization's IANA time zone. */
  timeZone: string;
  /** The service time the selected slot is needed for, when Planning Center says. */
  slotTimePreferenceOptionId?: string | null;
  /** A candidate's history, or undefined while it is loading. */
  historyFor: (personId: string) => CandidateHistory | undefined;
  /** Whether a blockout covers the plan date, or undefined while loading. */
  blockedFor: (personId: string) => boolean | undefined;
}

export interface AssembledPositionCandidates {
  people: PersonWithAvailability[];
  /**
   * Every candidate's history and availability arrived. Only then are scores computed (they are
   * normalized across available candidates) and people sorted for selection; until then people
   * keep the candidates' order and have no score.
   */
  complete: boolean;
}

/**
 * Builds the candidate list from whatever parts have arrived. The fresh roster decides the
 * selected slot and assignment labels. History supplies frequency
 * and calendar bars only; its older roster copy must not resurrect a removed assignment.
 */
export const assemblePositionCandidates = ({
  candidates,
  match,
  referenceDate,
  timeZone,
  slotTimePreferenceOptionId,
  historyFor,
  blockedFor,
}: PositionCandidateSources): AssembledPositionCandidates => {
  let complete = true;
  const people = candidates.map((candidate) => {
    const person = createCandidatePerson(candidate);
    const history = historyFor(candidate.id);
    applySelectedSlot(
      person,
      candidate.selectedPlanSlot,
      candidate.selectedPlanRosterLabels
    );
    if (history === undefined) {
      complete = false;
    } else {
      const summary = summarizeCandidateHistory(
        history.serviceHistory,
        referenceDate,
        timeZone
      );
      person.frequency = summary.frequency;
      person.serviceHistory = summary.serviceHistory;
    }

    const blocked = blockedFor(candidate.id);
    if (blocked === undefined) {
      complete = false;
      person.availability = "unknown";
    } else {
      person.isBlockedForDate = blocked;
      person.availability = blocked ? "blocked" : "available";
    }
    return person;
  });

  if (complete) {
    scoreAndNormalizePeople(people, referenceDate, timeZone, {
      planId: match.planId,
      slotTimePreferenceOptionId,
    });
    sortPeopleForSelection(people);
  }
  return { people, complete };
};
