import { keyName, parseMusicalKey, semitonesUp } from "./key-theory";
import type { ArrangementOption, PlanItem } from "./types";

/**
 * Facts about a song, never suggestions: the song a new one would follow, its history from a
 * plan's point of view, and what the add-song palette shows.
 */

/** A plan that scheduled the song: the fields of a `songs.history` row these facts read. */
export interface SongHistoryFact {
  planId: string | null;
  serviceTypeId: string | null;
  sortDate: Date;
  startingKey: string | null;
}

/** The song a new song would follow, and the key it ends in. */
export interface PreviousSong {
  title: string;
  endKey: string;
}

/**
 * The song right before the insertion point in the same section: a header starts a new
 * section, so nothing before it counts. `null` inserts at the end of the plan.
 */
export const previousSongBefore = (
  items: readonly PlanItem[],
  insertAfterId: string | null
): PreviousSong | null => {
  const insertIndex =
    insertAfterId === null
      ? items.length - 1
      : items.findIndex((item) => item.id === insertAfterId);
  for (let index = insertIndex; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined || item.itemType === "header") {
      return null;
    }
    if (item.itemType !== "song") {
      continue;
    }
    const endKey =
      parseMusicalKey(item.key?.endingKey) ??
      parseMusicalKey(item.key?.startingKey);
    return endKey === null
      ? null
      : { title: item.title || "the last song", endKey: keyName(endKey) };
  }
  return null;
};

const INTERVAL_NAMES = [
  "",
  "a half step",
  "a whole step",
  "a minor 3rd",
  "a major 3rd",
  "a 4th",
  "a tritone",
];
const RELATIVE_MINOR_SEMITONES = 9;
const RELATIVE_MAJOR_SEMITONES = 3;
const OCTAVE_SEMITONES = 12;

/**
 * How one key sits against another, in plain terms: "same key", "up a whole step",
 * "down a 4th", "relative minor". Describes the change without judging it.
 */
export const describeKeyChange = (from: string, to: string): string | null => {
  const fromKey = parseMusicalKey(from);
  const toKey = parseMusicalKey(to);
  if (fromKey === null || toKey === null) {
    return null;
  }
  const up = semitonesUp(fromKey, toKey);
  if (fromKey.minor !== toKey.minor) {
    if (up === 0) {
      return toKey.minor ? "parallel minor" : "parallel major";
    }
    if (!fromKey.minor && up === RELATIVE_MINOR_SEMITONES) {
      return "relative minor";
    }
    if (fromKey.minor && up === RELATIVE_MAJOR_SEMITONES) {
      return "relative major";
    }
  }
  if (up === 0) {
    return "same key";
  }
  const tritone = INTERVAL_NAMES.length - 1;
  let change = "a tritone away";
  if (up < tritone) {
    change = `up ${INTERVAL_NAMES[up] ?? ""}`;
  } else if (up > tritone) {
    change = `down ${INTERVAL_NAMES[OCTAVE_SEMITONES - up] ?? ""}`;
  }
  if (fromKey.minor === toKey.minor) {
    return change;
  }
  return `${change}, to ${toKey.minor ? "minor" : "major"}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

/** "3d", "4w", "5mo", "2y": how long before `reference` something happened. */
export const formatCompactAgo = (at: Date, reference: Date): string => {
  const days = Math.max(
    0,
    Math.floor((reference.getTime() - at.getTime()) / DAY_MS)
  );
  if (days < WEEK_DAYS) {
    return `${days}d`;
  }
  if (days < MONTH_DAYS * 2) {
    return `${Math.floor(days / WEEK_DAYS)}w`;
  }
  if (days < YEAR_DAYS) {
    return `${Math.floor(days / MONTH_DAYS)}mo`;
  }
  return `${Math.floor(days / YEAR_DAYS)}y`;
};

export interface SongHistorySummary<
  Entry extends SongHistoryFact = SongHistoryFact,
> {
  /** The latest time it was sung before the plan, at any service. */
  last: Entry | null;
  /** The soonest plan after this one that already has it. */
  next: Entry | null;
  timesThisYear: number;
  timesHere: number;
  /** Keys it has been sung in, most recent first. */
  keys: string[];
}

/**
 * What a song's history adds up to, counted from the plan's service date: what came
 * before it and what is planned after it, for one service type. The plan itself is
 * neither.
 */
export const summarizeSongHistory = <Entry extends SongHistoryFact>(
  history: readonly Entry[],
  planDate: Date,
  serviceTypeId: string | null
): SongHistorySummary<Entry> => {
  const past = history.filter((entry) => entry.sortDate < planDate);
  const upcoming = history.filter((entry) => entry.sortDate > planDate);
  const keys = new Set<string>();
  for (const entry of history) {
    if (entry.startingKey !== null) {
      keys.add(entry.startingKey);
    }
  }
  return {
    last: past[0] ?? null,
    next: upcoming.at(-1) ?? null,
    timesThisYear: past.length,
    timesHere: past.filter((entry) => entry.serviceTypeId === serviceTypeId)
      .length,
    keys: [...keys],
  };
};

/** "this plan" for the plan being built, "later" for plans after its date. */
export const songHistoryNote = (
  entry: SongHistoryFact,
  planId: string | null,
  planDate: Date
): string | null => {
  if (entry.planId !== null && entry.planId === planId) {
    return "this plan";
  }
  return entry.sortDate > planDate ? "later" : null;
};

/**
 * "Sung 4 times in the past year · 2 at Youth": how often the song came before the
 * plan, and how many of those were at the plan's service type, by name when known. A
 * `truncated` history read only its newest page, so its count is a floor: "Sung 97+ times".
 */
export const songHistoryCountLabel = (
  summary: Pick<SongHistorySummary, "timesThisYear" | "timesHere">,
  serviceTypeName: string | null,
  truncated: boolean
): string => {
  const { timesThisYear, timesHere } = summary;
  if (timesThisYear === 0) {
    return "Not sung in the past year";
  }
  let times = timesThisYear === 1 ? "once" : `${timesThisYear} times`;
  if (truncated) {
    times = `${timesThisYear}+ times`;
  }
  const sung = `Sung ${times} in the past year`;
  return serviceTypeName === null || serviceTypeName === ""
    ? sung
    : `${sung} · ${timesHere} at ${serviceTypeName}`;
};

/** "78 bpm · 6/8", or "" when the arrangement sets neither. */
export const tempoLabel = (
  arrangement: Pick<ArrangementOption, "bpm" | "meter"> | undefined
): string =>
  [
    arrangement?.bpm === null || arrangement?.bpm === undefined
      ? null
      : `${arrangement.bpm} bpm`,
    arrangement?.meter ?? null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

export interface SongPreviewFacts {
  summary: SongHistorySummary | null;
  /** Keys it was sung in, else its arrangements' keys. */
  keys: string[];
  tempos: string[];
  /** How its latest key sits against the previous song's ending. */
  keyChange: { key: string; change: string } | null;
}

/** What to show about a song being considered, from its history and arrangements. */
export const songPreviewFacts = ({
  history,
  arrangements,
  serviceTypeId,
  previousSong,
  planDate,
}: {
  history: readonly SongHistoryFact[] | undefined;
  arrangements: readonly ArrangementOption[];
  serviceTypeId: string | null;
  previousSong: PreviousSong | null;
  planDate: Date;
}): SongPreviewFacts => {
  const active = arrangements.filter((arrangement) => !arrangement.archived);
  const summary =
    history === undefined
      ? null
      : summarizeSongHistory(history, planDate, serviceTypeId);
  const arrangementKeys = active.flatMap((arrangement) =>
    arrangement.keys.flatMap((key) =>
      key.startingKey === null ? [] : [key.startingKey]
    )
  );
  const keys =
    summary !== null && summary.keys.length > 0
      ? summary.keys
      : [...new Set(arrangementKeys)];
  const latestKey = keys[0] ?? null;
  const change =
    previousSong === null || latestKey === null
      ? null
      : describeKeyChange(previousSong.endKey, latestKey);
  return {
    summary,
    keys,
    tempos: [
      ...new Set(
        active.flatMap((arrangement) => {
          const tempo = tempoLabel(arrangement);
          return tempo === "" ? [] : [tempo];
        })
      ),
    ],
    keyChange:
      change === null || latestKey === null ? null : { key: latestKey, change },
  };
};
