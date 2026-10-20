/**
 * Practice: a musician steps through the plan's songs with each one's chart and rehearsal
 * files. Pure rules for what the view lists and steps through; the view reads plan items and
 * plan files it already shares with the Plan tab and the files browser.
 */
import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import { Schema } from "effect";

import { fileBelongsToItem, sectionPlanFiles } from "@/lib/plan-files";

/** Songs and media are what a band rehearses; Next and Previous step through them. */
export const isPracticeStep = (item: PlanItem): boolean =>
  item.itemType === "song" || item.itemType === "media";

export interface SetlistGroup {
  /** The header the items sit under; null for items before the first header. */
  readonly header: PlanItem | null;
  readonly items: readonly PlanItem[];
}

/** The run sheet under its headers, in service order, leaving out empty headers. */
export const practiceSetlist = (items: readonly PlanItem[]): SetlistGroup[] => {
  const groups: { header: PlanItem | null; items: PlanItem[] }[] = [];
  for (const item of items) {
    if (item.itemType === "header") {
      groups.push({ header: item, items: [] });
      continue;
    }
    const current = groups.at(-1);
    if (current === undefined) {
      groups.push({ header: null, items: [item] });
    } else {
      current.items.push(item);
    }
  }
  return groups.filter((group) => group.items.length > 0);
};

/** The item to show: the one asked for when the plan has it, else the first song. */
export const resolvePracticeItem = (
  items: readonly PlanItem[],
  itemId?: string
): PlanItem | null =>
  items.find((item) => item.id === itemId && item.itemType !== "header") ??
  items.find(isPracticeStep) ??
  items.find((item) => item.itemType !== "header") ??
  null;

/** The song or media before or after `current` in service order; null at either end. */
export const adjacentStep = (
  items: readonly PlanItem[],
  current: PlanItem,
  direction: "previous" | "next"
): PlanItem | null => {
  const index = items.findIndex((item) => item.id === current.id);
  if (index === -1) {
    return null;
  }
  const after = items.slice(index + 1);
  const before = items.slice(0, index).toReversed();
  return (direction === "next" ? after : before).find(isPracticeStep) ?? null;
};

/** Where `current` sits among the songs and media, counting from one; null for other items. */
export const stepPosition = (
  items: readonly PlanItem[],
  current: PlanItem
): { readonly position: number; readonly total: number } | null => {
  const steps = items.filter(isPracticeStep);
  const index = steps.findIndex((item) => item.id === current.id);
  return index === -1 ? null : { position: index + 1, total: steps.length };
};

/** The order the song is played in this plan: its own sequence, else the arrangement's. */
export const playedSequence = (item: PlanItem): readonly string[] =>
  item.customArrangementSequence.length > 0
    ? item.customArrangementSequence
    : (item.arrangement?.sequence ?? []);

export interface PracticeFiles {
  /** Charts and lead sheets, generated chord chart first. */
  readonly charts: readonly PlanFile[];
  /** Recordings, then rehearsal mixes (the full mix before its parts). */
  readonly tracks: readonly PlanFile[];
  /** Videos and linked videos. */
  readonly videos: readonly PlanFile[];
  /** Everything else, such as Word documents. */
  readonly other: readonly PlanFile[];
}

/** The item's files by what a musician does with them. */
export const practiceFiles = (
  files: readonly PlanFile[],
  item: PlanItem
): PracticeFiles => {
  const sections = sectionPlanFiles(
    files.filter((file) => fileBelongsToItem(file, item))
  );
  const section = (name: (typeof sections)[number]["section"]) =>
    sections.find((entry) => entry.section === name)?.files ?? [];
  return {
    charts: section("charts"),
    tracks: [...section("audio"), ...section("mix")],
    videos: section("video"),
    other: section("other"),
  };
};

/** Chart text sizes, smallest first; the default is the middle one. */
export const CHART_TEXT_SIZES = ["sm", "base", "lg", "xl", "2xl"] as const;
export type ChartTextSize = (typeof CHART_TEXT_SIZES)[number];

export const CHART_MODES = ["chords", "lyrics"] as const;
export type ChartMode = (typeof CHART_MODES)[number];

const songPracticeSchema = Schema.Struct({
  /** The key chosen to practice in; absent plays the plan's key. */
  key: Schema.optional(Schema.String),
  capo: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 11 })),
});
export type SongPractice = typeof songPracticeSchema.Type;

/** What a musician last set, kept in this browser: the chart's look, and each song's capo. */
export const practicePrefsSchema = Schema.Struct({
  textSize: Schema.Literals(CHART_TEXT_SIZES),
  mode: Schema.Literals(CHART_MODES),
  /** By arrangement: a capo and key belong to how a song is played, not to one plan. */
  songs: Schema.Record(Schema.String, songPracticeSchema),
});
export type PracticePrefs = typeof practicePrefsSchema.Type;

export const DEFAULT_PRACTICE_PREFS: PracticePrefs = {
  textSize: "base",
  mode: "chords",
  songs: {},
};

export const NO_SONG_PRACTICE: SongPractice = { capo: 0 };

/** One step bigger or smaller, stopping at the ends. */
export const stepTextSize = (
  size: ChartTextSize,
  step: 1 | -1
): ChartTextSize => {
  const index = CHART_TEXT_SIZES.indexOf(size) + step;
  return CHART_TEXT_SIZES[
    Math.min(Math.max(index, 0), CHART_TEXT_SIZES.length - 1)
  ];
};

/** Saves a song's capo and key, forgetting songs left at the plan's key with no capo. */
export const withSongPractice = (
  prefs: PracticePrefs,
  arrangementId: string,
  song: SongPractice
): PracticePrefs => {
  const { [arrangementId]: _previous, ...others } = prefs.songs;
  const isDefault = song.capo === 0 && song.key === undefined;
  return {
    ...prefs,
    songs: isDefault ? others : { ...others, [arrangementId]: song },
  };
};

const SECONDS_PER_MINUTE = 60;

/** A media time as `m:ss`, such as `3:07`. */
export const formatPlaybackTime = (seconds: number): string => {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const rest = whole % SECONDS_PER_MINUTE;
  return `${String(minutes)}:${String(rest).padStart(2, "0")}`;
};

/** Playback speeds a musician slows a part down to, or nudges up. */
export const PLAYBACK_RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25] as const;

export interface LoopRegion {
  readonly start: number;
  readonly end: number;
}

export const LOOP_STEP = 0.1;
const DEFAULT_PASSAGE_SECONDS = 15;

/** A short passage around the playhead, kept inside the recording. */
export const initialLoop = (time: number, duration: number): LoopRegion => {
  const start = Math.max(0, Math.min(time, duration - DEFAULT_PASSAGE_SECONDS));
  return { start, end: Math.min(duration, start + DEFAULT_PASSAGE_SECONDS) };
};

/** An arrangement key Planning Center renders a chord chart PDF for. */
export interface ChartKey {
  readonly id: string;
  readonly startingKey: string | null;
}

/**
 * What the chart area shows: Planning Center's own PDF (a key's chord chart, or the lyric
 * sheet when `keyId` is null), or the chart drawn as text, for what Services doesn't render.
 */
export type ChartView =
  | { readonly kind: "pdf"; readonly keyId: string | null }
  | { readonly kind: "text"; readonly reason: "capo" | "key" };

const sameKey = (left: string | null, right: string | null): boolean => {
  const a = parseKey(left);
  const b = parseKey(right);
  return a !== null && b !== null && a.pitch === b.pitch && a.minor === b.minor;
};

/**
 * Planning Center's PDF whenever it renders one: the lyric sheet, the plan's key, or another key
 * on the arrangement. Services renders only saved keys, and no capo, so a key the arrangement
 * lacks or a capo falls back to the text chart.
 */
export const chartView = ({
  mode,
  keys,
  planKeyId,
  chosenKey,
  capo,
}: {
  readonly mode: ChartMode;
  readonly keys: readonly ChartKey[];
  readonly planKeyId: string | null;
  readonly chosenKey: string | undefined;
  readonly capo: number;
}): ChartView => {
  if (mode === "lyrics") {
    return { kind: "pdf", keyId: null };
  }
  if (capo > 0) {
    return { kind: "text", reason: "capo" };
  }
  const planKey = keys.find((key) => key.id === planKeyId);
  if (chosenKey === undefined && planKey !== undefined) {
    return { kind: "pdf", keyId: planKey.id };
  }
  const wanted = chosenKey ?? planKey?.startingKey ?? null;
  const match = keys.find((key) => sameKey(key.startingKey, wanted));
  return match === undefined
    ? { kind: "text", reason: "key" }
    : { kind: "pdf", keyId: match.id };
};

/** The audio transport's state, including terminal failures that disable stale controls. */
export interface PlaybackState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly playing: boolean;
  readonly time: number;
  readonly duration: number;
}

export const STOPPED_RECORDING: PlaybackState = {
  status: "idle",
  playing: false,
  time: 0,
  duration: 0,
};
export const RECORDING_FAILURE: PlaybackState = {
  ...STOPPED_RECORDING,
  status: "failed",
};
