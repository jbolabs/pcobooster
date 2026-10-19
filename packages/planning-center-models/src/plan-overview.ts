import type {
  PlanItem,
  PlanTime,
  TeamPosition,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";

import { collectUnnotifiedPeople } from "./scheduling-notifications";

export type PlanView = "overview" | "lineup" | "plan" | "times" | "assign";

/** A position that still needs people, as a link target into Assign. */
export interface OpenPosition {
  teamId: string;
  teamName: string;
  positionId: string;
  positionName: string;
  source: TeamPosition["source"];
  openCount: number;
}

export interface TeamStaffing {
  teamId: string;
  teamName: string;
  confirmed: number;
  pending: number;
  open: number;
}

export interface PlanStaffing {
  confirmed: number;
  pending: number;
  open: number;
  /** Confirmed, pending, and open slots together. */
  total: number;
  /** People whose scheduling email is prepared but unsent. */
  unnotified: number;
  teams: TeamStaffing[];
  openPositions: OpenPosition[];
}

/** Counts filled and open slots per team; teams with nothing requested or scheduled drop out. */
export const summarizeStaffing = (
  groups: readonly TeamPositionGroup[]
): PlanStaffing => {
  const teams: TeamStaffing[] = [];
  const openPositions: OpenPosition[] = [];
  for (const group of groups) {
    const team: TeamStaffing = {
      teamId: group.teamId,
      teamName: group.teamName,
      confirmed: 0,
      pending: 0,
      open: 0,
    };
    for (const position of group.positions) {
      const openCount = Math.max(0, position.neededCount ?? 0);
      team.confirmed += position.filledConfirmedCount ?? 0;
      team.pending += position.filledPendingCount ?? 0;
      team.open += openCount;
      if (openCount > 0) {
        openPositions.push({
          teamId: group.teamId,
          teamName: group.teamName,
          positionId: position.id,
          positionName: position.name,
          source: position.source,
          openCount,
        });
      }
    }
    if (team.confirmed + team.pending + team.open > 0) {
      teams.push(team);
    }
  }
  const confirmed = teams.reduce((sum, team) => sum + team.confirmed, 0);
  const pending = teams.reduce((sum, team) => sum + team.pending, 0);
  const open = teams.reduce((sum, team) => sum + team.open, 0);
  return {
    confirmed,
    pending,
    open,
    total: confirmed + pending + open,
    unnotified: collectUnnotifiedPeople(groups).length,
    teams,
    openPositions,
  };
};

export interface PlanSong {
  id: string;
  /** The song in the library, and the arrangement the plan uses; null for an unlinked item. */
  songId: string | null;
  arrangementId: string | null;
  title: string;
  /** "G", or "G to A" when the song modulates; null when the item has no key. */
  keyLabel: string | null;
  length: number | null;
}

export interface PlanOrder {
  songs: PlanSong[];
  songsWithoutKey: number;
  /** Seconds of items during the service; pre- and post-service items don't count. */
  serviceLength: number;
  itemCount: number;
}

export const keyLabelOf = (key: PlanItem["key"]): string | null => {
  const start = key?.startingKey ?? null;
  if (start === null || start === "") {
    return null;
  }
  const end = key?.endingKey ?? null;
  return end === null || end === "" || end === start
    ? start
    : `${start} to ${end}`;
};

/**
 * A key option's key and its description (Planning Center's key name, often whose key it
 * is), dropping the description when it is missing or only repeats the key.
 */
export interface KeyOptionParts {
  label: string;
  description: string | null;
}

export const keyOptionPartsOf = (
  key: NonNullable<PlanItem["key"]>
): KeyOptionParts => {
  const label = keyLabelOf(key);
  const description = key.name.trim();
  if (label === null) {
    return { label: description, description: null };
  }
  const repeatsKey =
    description === "" ||
    description === label ||
    description === `${key.startingKey} -> ${key.endingKey}`;
  return { label, description: repeatsKey ? null : description };
};

/** Key picker label: "{key}: {description}", dropping whichever part is missing or redundant. */
export const keyOptionLabelOf = (key: NonNullable<PlanItem["key"]>): string => {
  const { label, description } = keyOptionPartsOf(key);
  return description === null ? label : `${label}: ${description}`;
};

export const summarizeOrder = (items: readonly PlanItem[]): PlanOrder => {
  const ordered = items.toSorted((a, b) => a.sequence - b.sequence);
  const songs: PlanSong[] = [];
  for (const item of ordered) {
    if (item.itemType === "song") {
      songs.push({
        id: item.id,
        songId: item.song?.id ?? null,
        arrangementId: item.arrangement?.id ?? null,
        title: item.song?.title ?? item.title,
        keyLabel: keyLabelOf(item.key),
        length: item.length,
      });
    }
  }
  const serviceLength = ordered
    .filter(
      (item) => item.servicePosition === "during" && item.itemType !== "header"
    )
    .reduce((sum, item) => sum + Math.max(0, item.length ?? 0), 0);
  return {
    songs,
    songsWithoutKey: songs.filter((song) => song.keyLabel === null).length,
    serviceLength,
    itemCount: ordered.filter((item) => item.itemType !== "header").length,
  };
};

export interface PlanSchedule {
  /** Every time in start order. */
  times: PlanTime[];
  serviceCount: number;
  rehearsalCount: number;
}

export const summarizeTimes = (times: readonly PlanTime[]): PlanSchedule => ({
  times: times.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
  serviceCount: times.filter((time) => time.timeType === "service").length,
  rehearsalCount: times.filter((time) => time.timeType === "rehearsal").length,
});

export type ReadinessState = "done" | "todo";

export interface ReadinessCheck {
  id: "positions" | "notifications" | "responses" | "songs" | "keys" | "times";
  state: ReadinessState;
  label: string;
  view: PlanView;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const staffingChecks = (staffing: PlanStaffing): ReadinessCheck[] => {
  if (staffing.total === 0) {
    return [
      {
        id: "positions",
        state: "todo",
        label: "No one is scheduled yet",
        view: "assign",
      },
    ];
  }
  const checks: ReadinessCheck[] = [
    staffing.open > 0
      ? {
          id: "positions",
          state: "todo",
          label: `${plural(staffing.open, "position needs", "positions need")} someone`,
          view: "assign",
        }
      : {
          id: "positions",
          state: "done",
          label: "Every position is filled",
          view: "lineup",
        },
  ];
  if (staffing.unnotified > 0) {
    checks.push({
      id: "notifications",
      state: "todo",
      label: `${plural(staffing.unnotified, "person hasn't", "people haven't")} been notified`,
      view: "lineup",
    });
  }
  if (staffing.pending > 0) {
    checks.push({
      id: "responses",
      state: "todo",
      label: `${plural(staffing.pending, "person hasn't", "people haven't")} responded`,
      view: "lineup",
    });
  } else if (staffing.confirmed > 0) {
    checks.push({
      id: "responses",
      state: "done",
      label: "Everyone scheduled has confirmed",
      view: "lineup",
    });
  }
  return checks;
};

const orderChecks = (order: PlanOrder): ReadinessCheck[] => {
  if (order.songs.length === 0) {
    return [
      { id: "songs", state: "todo", label: "No songs yet", view: "plan" },
    ];
  }
  return [
    {
      id: "songs",
      state: "done",
      label: `${plural(order.songs.length, "song", "songs")} planned`,
      view: "plan",
    },
    order.songsWithoutKey > 0
      ? {
          id: "keys",
          state: "todo",
          label: `${plural(order.songsWithoutKey, "song has", "songs have")} no key`,
          view: "plan",
        }
      : {
          id: "keys",
          state: "done",
          label: "Every song has a key",
          view: "plan",
        },
  ];
};

const timeChecks = (schedule: PlanSchedule): ReadinessCheck[] => [
  schedule.serviceCount === 0
    ? { id: "times", state: "todo", label: "No service times", view: "times" }
    : {
        id: "times",
        state: "done",
        label:
          schedule.rehearsalCount === 0
            ? plural(schedule.serviceCount, "service time", "service times")
            : `${plural(schedule.serviceCount, "service time", "service times")} and ${plural(schedule.rehearsalCount, "rehearsal", "rehearsals")}`,
        view: "times",
      },
];

/**
 * What still needs doing before the plan is ready, from whichever parts have loaded. A part
 * that hasn't loaded yet contributes no checks rather than a guess.
 */
export const buildReadinessChecks = ({
  staffing,
  order,
  schedule,
}: {
  staffing: PlanStaffing | null;
  order: PlanOrder | null;
  schedule: PlanSchedule | null;
}): ReadinessCheck[] => [
  ...(staffing ? staffingChecks(staffing) : []),
  ...(order ? orderChecks(order) : []),
  ...(schedule ? timeChecks(schedule) : []),
];

/** "1:05:00" or "42:10"; null for no length. */
export const formatDuration = (seconds: number): string | null => {
  const total = Math.max(0, Math.floor(seconds));
  if (total === 0) {
    return null;
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
};

const timeOfDayFormatters = new Map<string, Intl.DateTimeFormat>();

/** "9:30 AM" in the organization's zone. */
export const formatTimeOfDay = (instant: Date, timeZone: string): string => {
  const zone = timeZone === "" ? "UTC" : timeZone;
  let formatter = timeOfDayFormatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    });
    timeOfDayFormatters.set(zone, formatter);
  }
  return formatter.format(instant);
};
