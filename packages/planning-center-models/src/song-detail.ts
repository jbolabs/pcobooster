import {
  formatCalendarDateLabel,
  formatCalendarDayInTimeZone,
  orgCalendarDaysBetween,
} from "./calendar";
import {
  formatCompactDays,
  songHistoryCountLabel,
  summarizeSongHistory,
} from "./song-library";
import type { ArrangementOption, KeyOption } from "./types";

/**
 * One song's facts, shared by the web and iOS song pages: when it was last and next sung, how
 * often and where, and its arrangements. Facts only: nothing here ranks, suggests, or judges a
 * song.
 */

/** A plan that scheduled the song, as `songs.history` answers it. */
export interface SongHistoryEntry {
  readonly planId: string | null;
  readonly serviceTypeId: string | null;
  readonly serviceTypeName: string;
  readonly sortDate: Date;
  readonly keyName: string | null;
  readonly startingKey: string | null;
  readonly arrangementName: string | null;
}

/** Active arrangements first, then archived ones, each in the order Planning Center sent. */
export const activeFirst = <Arrangement extends { readonly archived: boolean }>(
  arrangements: readonly Arrangement[]
): Arrangement[] => [
  ...arrangements.filter((arrangement) => !arrangement.archived),
  ...arrangements.filter((arrangement) => arrangement.archived),
];

export interface SongHistorySplit<Entry extends SongHistoryEntry> {
  /** Plans after now that already have the song, soonest first. */
  readonly upcoming: readonly Entry[];
  /** Plans at or before now, newest first. */
  readonly past: readonly Entry[];
}

/** `songs.history` is newest first; splits it at `now`. */
export const splitSongHistory = <Entry extends SongHistoryEntry>(
  history: readonly Entry[],
  now: Date
): SongHistorySplit<Entry> => ({
  upcoming: history.filter((entry) => entry.sortDate > now).toReversed(),
  past: history.filter((entry) => entry.sortDate <= now),
});

export const serviceTypeLabel = (name: string): string =>
  name === "" ? "Unknown service" : name;

export interface ServiceTypeCount {
  readonly name: string;
  readonly count: number;
}

/** How the past year splits across service types, most first: "10 at Sunday Gathering". */
export const serviceTypeCounts = (
  past: readonly SongHistoryEntry[]
): ServiceTypeCount[] => {
  const counts = new Map<string, number>();
  for (const entry of past) {
    const name = serviceTypeLabel(entry.serviceTypeName);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

/** More than one arrangement shows up in the history, so its rows name theirs. */
export const historyNamesArrangements = (
  history: readonly SongHistoryEntry[]
): boolean =>
  new Set(
    history.flatMap((entry) =>
      entry.arrangementName === null ? [] : [entry.arrangementName]
    )
  ).size > 1;

/** The arrangement (when the history spans several) and a named key ("Jordan's key"). */
export const historyRowDetail = (
  entry: SongHistoryEntry,
  namesArrangement: boolean
): string | null => {
  const parts: string[] = [];
  const { arrangementName, keyName } = entry;
  if (namesArrangement && arrangementName !== null && arrangementName !== "") {
    parts.push(arrangementName);
  }
  if (
    keyName !== null &&
    keyName !== "" &&
    keyName !== "Original" &&
    keyName !== entry.startingKey
  ) {
    parts.push(keyName);
  }
  return parts.length === 0 ? null : parts.join(" · ");
};

/**
 * "Sat, Oct 3, 2026 · Default Arrangement · Jordan's key": a history row's full day in the
 * congregation's zone, then the arrangement and named key it was sung in.
 */
export const historyRowFullLabel = (
  entry: SongHistoryEntry,
  timeZone: string
): string => {
  const detail = historyRowDetail(entry, true);
  const day = formatCalendarDateLabel(
    entry.sortDate,
    timeZone,
    "weekdayMonthDayYear"
  );
  return detail === null ? day : `${day} · ${detail}`;
};

const sameOrgYear = (a: Date, b: Date, timeZone: string): boolean =>
  formatCalendarDayInTimeZone(a, timeZone).slice(0, 4) ===
  formatCalendarDayInTimeZone(b, timeZone).slice(0, 4);

/** "Sep 27" this year, "Mar 10, 2024" before or after it, in the org's calendar. */
export const compactDate = (date: Date, now: Date, timeZone: string): string =>
  formatCalendarDateLabel(
    date,
    timeZone,
    sameOrgYear(date, now, timeZone) ? "monthDay" : "monthDayYear"
  );

/** "Sun, Oct 4" this year, "Nov 9, 2025" in another, for history rows. */
export const historyDateLabel = (
  date: Date,
  now: Date,
  timeZone: string
): string =>
  formatCalendarDateLabel(
    date,
    timeZone,
    sameOrgYear(date, now, timeZone) ? "weekdayMonthDay" : "monthDayYear"
  );

/**
 * How long ago a service was, in the congregation's calendar days: "Today", "Yesterday", then
 * "3d ago", "2w ago".
 */
export const sungAgoLabel = (
  date: Date,
  now: Date,
  timeZone: string
): string => {
  const days = orgCalendarDaysBetween(date, now, timeZone);
  if (days <= 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  return `${formatCompactDays(days)} ago`;
};

/** One line of the song's summary: a label, its value, and a muted caption. */
export interface SongFact {
  readonly label: string;
  readonly value: string;
  readonly caption: string | null;
  readonly accessibilityValue: string;
}

/**
 * Last sung, next planned (and where), and how often in the past year (and in which keys),
 * counted from `now`. A truncated history read only its newest page, so its count is a floor:
 * "100+ times".
 */
export const songFacts = (
  history: readonly SongHistoryEntry[],
  now: Date,
  timeZone: string,
  truncated: boolean
): SongFact[] => {
  // The same split as the page's Upcoming and Past year rows.
  const { upcoming, past } = splitSongHistory(history, now);
  const [last] = past;
  const [next] = upcoming;
  // Keys it was sung in: past plans only, not ones still ahead.
  const sungKeys = [
    ...new Set(
      past.flatMap((entry) =>
        entry.startingKey === null ? [] : [entry.startingKey]
      )
    ),
  ];
  const lastSung: SongFact =
    last === undefined
      ? {
          label: "Last sung",
          value: "Not in the past year",
          caption: null,
          accessibilityValue: "Not in the past year",
        }
      : {
          label: "Last sung",
          value: compactDate(last.sortDate, now, timeZone),
          caption: sungAgoLabel(last.sortDate, now, timeZone),
          accessibilityValue: formatCalendarDateLabel(
            last.sortDate,
            timeZone,
            "weekdayMonthDayYear"
          ),
        };
  const nextPlanned: SongFact =
    next === undefined
      ? {
          label: "Next",
          value: "Not planned",
          caption: null,
          accessibilityValue: "Not planned",
        }
      : {
          label: "Next",
          value: compactDate(next.sortDate, now, timeZone),
          caption: next.serviceTypeName === "" ? null : next.serviceTypeName,
          accessibilityValue: formatCalendarDateLabel(
            next.sortDate,
            timeZone,
            "weekdayMonthDayYear"
          ),
        };
  let times = `${past.length} times`;
  if (truncated) {
    times = `${past.length}+ times`;
  } else if (past.length === 1) {
    times = "Once";
  }
  return [
    lastSung,
    nextPlanned,
    {
      label: "Past year",
      value: times,
      caption: sungKeys.length === 0 ? null : `Sung in ${sungKeys.join(", ")}`,
      accessibilityValue: times,
    },
  ];
};

/** "Sung 12 times in the past year · 10 at Sunday Gathering, 2 at Youth Night". */
export const historyCountLine = (
  history: readonly SongHistoryEntry[],
  now: Date,
  truncated: boolean
): string => {
  const summary = summarizeSongHistory(history, now, null);
  const label = songHistoryCountLabel(summary, null, truncated);
  const counts = serviceTypeCounts(splitSongHistory(history, now).past);
  if (counts.length === 0) {
    return label;
  }
  if (counts.length === 1) {
    return `${label} · ${counts[0]?.name ?? ""}`;
  }
  return `${label} · ${counts.map(({ name, count }) => `${count} at ${name}`).join(", ")}`;
};

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** "5:00", "1:02:03": an arrangement's length. */
export const formatLength = (seconds: number): string | null => {
  const total = Math.round(seconds);
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = String(total % SECONDS_PER_MINUTE).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
};

/** An arrangement's length, tempo, and meter, as Planning Center has them. */
export interface ArrangementTiming {
  /** Seconds. */
  readonly length: number | null;
  readonly bpm: number | null;
  readonly meter: string | null;
}

/** One part of an arrangement's facts line: "4:13", "70" with its unit "bpm", "4/4". */
export interface ArrangementFact {
  readonly label: "Length" | "Tempo" | "Meter";
  readonly value: string;
  readonly unit: string | null;
}

/** Length, tempo, then meter; a fact Planning Center doesn't set is left out. */
export const arrangementFacts = (
  arrangement: ArrangementTiming
): ArrangementFact[] => {
  const facts: ArrangementFact[] = [];
  const length =
    arrangement.length === null ? null : formatLength(arrangement.length);
  if (length !== null) {
    facts.push({ label: "Length", value: length, unit: null });
  }
  if (arrangement.bpm !== null && arrangement.bpm > 0) {
    facts.push({ label: "Tempo", value: String(arrangement.bpm), unit: "bpm" });
  }
  const meter = arrangement.meter?.trim() ?? "";
  if (meter !== "") {
    facts.push({ label: "Meter", value: meter, unit: null });
  }
  return facts;
};

/** "4:13 · 70 bpm · 4/4", or null when Planning Center sets none of them. */
export const arrangementFactsLine = (
  arrangement: ArrangementTiming
): string | null => {
  const facts = arrangementFacts(arrangement).map((fact) =>
    fact.unit === null ? fact.value : `${fact.value} ${fact.unit}`
  );
  return facts.length === 0 ? null : facts.join(" · ");
};

/** An arrangement as the chord chart read names it, before `songs.options` answers. */
export interface ChartArrangementSummary extends ArrangementTiming {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly keys: readonly KeyOption[];
  readonly sequence: readonly string[];
}

/** What an arrangement row shows, from `songs.options` or, until it loads, the chart read. */
export interface ArrangementRowData {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly keys: readonly KeyOption[];
  /** "5:00 · 74 bpm · 4/4", or null when Planning Center sets none of them. */
  readonly facts: string | null;
  readonly sequence: readonly string[];
}

export const arrangementDisplayName = (name: string): string =>
  name === "" ? "Untitled arrangement" : name;

const toArrangementRow = (
  arrangement: ChartArrangementSummary
): ArrangementRowData => ({
  id: arrangement.id,
  name: arrangementDisplayName(arrangement.name),
  archived: arrangement.archived,
  keys: arrangement.keys,
  facts: arrangementFactsLine(arrangement),
  sequence: arrangement.sequence,
});

export const arrangementRows = (
  options?: readonly ArrangementOption[],
  charts?: readonly ChartArrangementSummary[]
): ArrangementRowData[] =>
  activeFirst(
    options !== undefined && options.length > 0 ? options : (charts ?? [])
  ).map(toArrangementRow);

/** "G", or "A · Jordan's key" when the key has its own name. */
export const keyLabel = (key: KeyOption): string => {
  const name = key.name.trim();
  const start = key.startingKey ?? "";
  if (name === "" || name === "Original" || name === start) {
    return start === "" ? "No key" : start;
  }
  return start === "" ? name : `${start} · ${name}`;
};

/** "Ends in B" when the key changes by the end of the song. */
export const keyEndingLabel = (key: KeyOption): string | null =>
  key.endingKey === null ||
  key.endingKey === "" ||
  key.endingKey === key.startingKey
    ? null
    : `Ends in ${key.endingKey}`;

/** The chosen key on the chart: "G", or "G → A" when it ends somewhere else. */
export const keyContextLabel = (key: KeyOption): string => {
  const start = key.startingKey ?? keyLabel(key);
  return keyEndingLabel(key) === null ? start : `${start} → ${key.endingKey}`;
};

/** The primary chart action: "Chart in G", or "Chart" for the lyrics sheet. */
export const chartActionLabel = (key: KeyOption | null): string => {
  if (key === null) {
    return "Chart";
  }
  const start = key.startingKey ?? "";
  return start === "" ? `Chart in ${keyLabel(key)}` : `Chart in ${start}`;
};

/** Why a chart has no PDF yet: "No chart in G yet", or the lyrics sheet's. */
export const missingChartLabel = (key: KeyOption | null): string =>
  key === null
    ? "No lyrics sheet yet"
    : `No chart in ${key.startingKey ?? keyLabel(key)} yet`;

/** "70 bpm · G, A": what tells arrangements apart in a picker. */
export const arrangementPickerDetail = (
  arrangement: Pick<ChartArrangementSummary, "bpm" | "keys">
): string => {
  const starts = [
    ...new Set(
      arrangement.keys.flatMap((key) =>
        key.startingKey === null || key.startingKey === ""
          ? []
          : [key.startingKey]
      )
    ),
  ];
  return [
    arrangement.bpm === null || arrangement.bpm <= 0
      ? null
      : `${arrangement.bpm} bpm`,
    starts.length === 0 ? null : starts.join(", "),
  ]
    .filter((part) => part !== null)
    .join(" · ");
};

/** What a song page's search asks for: `?arrangement=&key=`. */
export interface SongPageSearch {
  readonly arrangement?: string | undefined;
  readonly key?: string | undefined;
}

export interface SongPageSelection<
  Arrangement extends ChartArrangementSummary,
> {
  /** Active first, then archived. */
  readonly arrangements: readonly Arrangement[];
  /** Null when the song has no arrangements. */
  readonly arrangement: Arrangement | null;
  /** Null for the lyrics sheet: the arrangement has no keys. */
  readonly key: KeyOption | null;
  /** The search naming what is shown. */
  readonly search: SongPageSearch;
  /** The asked-for search names something else, so the URL should be replaced with `search`. */
  readonly stale: boolean;
}

/**
 * The arrangement and key a song page shows: the ones the URL names, else the first active
 * arrangement (the first archived one when all are) and its first key.
 */
export const songPageSelection = <Arrangement extends ChartArrangementSummary>(
  arrangements: readonly Arrangement[],
  requested: SongPageSearch
): SongPageSelection<Arrangement> => {
  const ordered = activeFirst(arrangements);
  const arrangement =
    ordered.find((candidate) => candidate.id === requested.arrangement) ??
    ordered[0] ??
    null;
  const key =
    arrangement?.keys.find((candidate) => candidate.id === requested.key) ??
    arrangement?.keys[0] ??
    null;
  const search: SongPageSearch = {
    arrangement: arrangement?.id,
    key: key?.id,
  };
  return {
    arrangements: ordered,
    arrangement,
    key,
    search,
    stale:
      search.arrangement !== requested.arrangement ||
      search.key !== requested.key,
  };
};

/** Copyright text that already says what it is, or isn't a bare year and holder. */
const SELF_DESCRIBED_COPYRIGHT =
  /public domain|words:|music:|©|\(c\)|copyright/iu;
const BARE_COPYRIGHT_START = /^[\p{L}\p{N}]/u;

/**
 * The copyright as Planning Center has it, marked "©" only when it is a bare year and holder
 * ("2013 Hillsong Music"). Text that already says what it is ("Public Domain", "Words: …",
 * "Copyright …") stays as written.
 */
export const copyrightLabel = (copyright: string): string => {
  const text = copyright.trim();
  if (SELF_DESCRIBED_COPYRIGHT.test(text) || !BARE_COPYRIGHT_START.test(text)) {
    return text;
  }
  return `© ${text}`;
};

/**
 * The song's credits, each shown in full: writers, "CCLI 6605236", and the copyright. Missing
 * and repeated parts are skipped; the page joins them with " · ".
 */
export const songCreditParts = (song: {
  readonly author: string;
  readonly ccliNumber: number | null;
  readonly copyright: string | null;
}): string[] => {
  const parts: string[] = [];
  const author = song.author.trim();
  if (author !== "") {
    parts.push(author);
  }
  if (song.ccliNumber !== null) {
    parts.push(`CCLI ${song.ccliNumber}`);
  }
  const copyright = song.copyright?.trim() ?? "";
  if (copyright !== "") {
    parts.push(copyrightLabel(copyright));
  }
  // A writer field that repeats the copyright ("Public Domain" in both) shows once.
  return [...new Set(parts)];
};

/** A group of files on the song page: the arrangement's own, or one key's. */
export interface SongFileGroup<File> {
  readonly id: string;
  /** "Arrangement", a key ("G"), or "Other keys". */
  readonly label: string;
  readonly files: readonly File[];
}

/**
 * The arrangement's own files first, then each key's in the arrangement's key order. With two
 * or more keys, only the chosen key's files show beside the arrangement's, so a player sees
 * one key's stems rather than every key's.
 */
export const songFileGroups = <File extends { readonly keyId: string | null }>(
  files: readonly File[],
  keys: readonly KeyOption[],
  chosenKeyId: string | null
): SongFileGroup<File>[] => {
  const scoped = keys.length > 1;
  const shownKeys = scoped
    ? keys.filter((key) => key.id === chosenKeyId)
    : keys;
  const known = new Set(keys.map((key) => key.id));
  const groups: SongFileGroup<File>[] = [
    {
      id: "arrangement",
      label: "Arrangement",
      files: files.filter((file) => file.keyId === null),
    },
    ...shownKeys.map((key) => ({
      id: key.id,
      label: keyLabel(key),
      files: files.filter((file) => file.keyId === key.id),
    })),
    {
      id: "other",
      label: "Other keys",
      files: files.filter(
        (file) => file.keyId !== null && !known.has(file.keyId)
      ),
    },
  ];
  return groups.filter((group) => group.files.length > 0);
};

/** One of the song page's notes: the arrangement's (band directions) first, then the song's. */
export interface SongNote {
  readonly source: "Arrangement" | "Song";
  readonly text: string;
}

export const songNotes = (
  arrangement: { readonly notes: string | null } | null,
  song: { readonly notes: string | null }
): SongNote[] => {
  const notes: SongNote[] = [];
  const arrangementText = arrangement?.notes?.trim() ?? "";
  if (arrangementText !== "") {
    notes.push({ source: "Arrangement", text: arrangementText });
  }
  const songText = song.notes?.trim() ?? "";
  if (songText !== "") {
    notes.push({ source: "Song", text: songText });
  }
  return notes;
};

/**
 * The latest service type the song was sung at, for reading `songs.options`. The arrangements
 * it returns are the same for every service type; one the song was on is one the person sees.
 */
export const historyServiceTypeId = (
  history: readonly SongHistoryEntry[] | undefined
): string | null =>
  history?.find((entry) => entry.serviceTypeId !== null)?.serviceTypeId ?? null;

/** Planning Center Services pages, where hiding, deleting, and attachments live. */
export const planningCenterSongUrl = (songId: string): string =>
  `https://services.planningcenteronline.com/songs/${encodeURIComponent(songId)}`;

export const planningCenterArrangementUrl = (
  songId: string,
  arrangementId: string
): string =>
  `${planningCenterSongUrl(songId)}/arrangements/${encodeURIComponent(arrangementId)}`;
