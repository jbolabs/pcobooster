import type { SongLibraryEntry } from "@pcobooster/contracts/http/songs";
import { scoreSongSearch } from "@pcobooster/planning-center-models/song-search";

/** Which songs the library lists; the `unused` filters reach back whole calendar months. */
export const songLibraryFilters = [
  { value: "all", label: "All songs" },
  { value: "unused-6", label: "Unused 6+ months", months: 6 },
  { value: "unused-12", label: "Unused 1+ year", months: 12 },
  { value: "unused-24", label: "Unused 2+ years", months: 24 },
  { value: "never", label: "Never scheduled" },
] as const;

export type SongLibraryFilter = (typeof songLibraryFilters)[number]["value"];

export const songLibrarySorts = [
  { value: "recent", label: "Recently used" },
  { value: "title", label: "Title" },
  { value: "longest", label: "Longest unused" },
] as const;

export type SongLibrarySort = (typeof songLibrarySorts)[number]["value"];

export const DEFAULT_SONG_LIBRARY_FILTER: SongLibraryFilter = "all";
export const DEFAULT_SONG_LIBRARY_SORT: SongLibrarySort = "recent";

export const parseSongLibraryFilter = (
  value: string | undefined
): SongLibraryFilter =>
  songLibraryFilters.find((filter) => filter.value === value)?.value ??
  DEFAULT_SONG_LIBRARY_FILTER;

export const parseSongLibrarySort = (
  value: string | undefined
): SongLibrarySort =>
  songLibrarySorts.find((sort) => sort.value === value)?.value ??
  DEFAULT_SONG_LIBRARY_SORT;

/** `now` moved back `months` calendar months in UTC, clamped to the target month's last day. */
export const monthsBefore = (now: Date, months: number): Date => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes()
    )
  );
};

/** The instant an `unused` filter looks back to; null for the other filters. */
export const songLibraryCutoff = (
  filter: SongLibraryFilter,
  now: Date
): Date | null => {
  const match = songLibraryFilters.find((option) => option.value === filter);
  return match !== undefined && "months" in match
    ? monthsBefore(now, match.months)
    : null;
};

/**
 * Not on any plan since `cutoff`. A never-scheduled song counts only once it is older than the
 * cutoff, so songs added recently aren't suggested for hiding.
 */
const isUnusedSince = (song: SongLibraryEntry, cutoff: Date) => {
  const lastUsed = song.lastScheduledAt ?? song.createdAt;
  return lastUsed === null || lastUsed < cutoff;
};

const byTitle = (a: SongLibraryEntry, b: SongLibraryEntry) =>
  a.title.localeCompare(b.title);

const timeOf = (date: Date | null, missing: number) =>
  date === null ? missing : date.getTime();

const compareSongs: Record<
  SongLibrarySort,
  (a: SongLibraryEntry, b: SongLibraryEntry) => number
> = {
  // Latest plan first (Planning Center counts upcoming plans); never-scheduled songs last.
  recent: (a, b) =>
    timeOf(b.lastScheduledAt, Number.NEGATIVE_INFINITY) -
      timeOf(a.lastScheduledAt, Number.NEGATIVE_INFINITY) || byTitle(a, b),
  title: byTitle,
  // Never-scheduled songs first, oldest added first, then the longest since used.
  longest: (a, b) => {
    const aNever = a.lastScheduledAt === null;
    const bNever = b.lastScheduledAt === null;
    if (aNever !== bNever) {
      return aNever ? -1 : 1;
    }
    const aTime = aNever
      ? timeOf(a.createdAt, Number.NEGATIVE_INFINITY)
      : timeOf(a.lastScheduledAt, 0);
    const bTime = bNever
      ? timeOf(b.createdAt, Number.NEGATIVE_INFINITY)
      : timeOf(b.lastScheduledAt, 0);
    return aTime - bTime || byTitle(a, b);
  },
};

export interface SongLibraryView {
  readonly filter: SongLibraryFilter;
  readonly sort: SongLibrarySort;
  /** A search ranks matches by relevance instead of `sort`. */
  readonly query: string;
}

/** The songs a library view lists, in the order it lists them. */
export const selectSongLibrary = (
  songs: readonly SongLibraryEntry[],
  { filter, sort, query }: SongLibraryView,
  now: Date
): SongLibraryEntry[] => {
  const cutoff = songLibraryCutoff(filter, now);
  const listed = songs.filter((song) => {
    if (filter === "never") {
      return song.lastScheduledAt === null;
    }
    return cutoff === null || isUnusedSince(song, cutoff);
  });
  const trimmed = query.trim();
  if (trimmed === "") {
    return listed.toSorted(compareSongs[sort]);
  }
  return listed
    .flatMap((song) => {
      const score = scoreSongSearch(song, trimmed, now);
      return score > 0 ? [{ song, score }] : [];
    })
    .toSorted((a, b) => b.score - a.score || byTitle(a.song, b.song))
    .map(({ song }) => song);
};
