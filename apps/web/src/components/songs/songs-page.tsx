import { speculativeQuery } from "@pcobooster/client/query";
import type { SongLibraryEntry } from "@pcobooster/contracts/http/songs";
import { formatCalendarDateLabel } from "@pcobooster/planning-center-models/calendar";
import { planningCenterSongUrl } from "@pcobooster/planning-center-models/song-detail";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, Plus, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { AddSongDialog } from "@/components/songs/add-song-dialog";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { HoverLabel } from "@/components/ui/hover-card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ItemList } from "@/components/ui/item";
import { LoadingBar } from "@/components/ui/loading-bar";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { createChordChartSongQueryOptions } from "@/hooks/use-chord-chart-song";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { useSongLibrary } from "@/hooks/use-song-library";
import { currentDate } from "@/lib/clock";
import { isQueryFresh } from "@/lib/intent-prefetch";
import {
  RECENT_SONGS_STORAGE_KEY,
  matchRecentSongs,
  parseRecentSongs,
} from "@/lib/recent-songs";
import type { RecentSong } from "@/lib/recent-songs";
import {
  selectSongLibrary,
  songLibraryCutoff,
  songLibraryFilters,
  songLibrarySorts,
} from "@/lib/songs-index";
import type { SongLibraryFilter, SongLibrarySort } from "@/lib/songs-index";
import { cn } from "@/lib/utils";

/** Rows the list renders before "Show more"; libraries run to well over a thousand songs. */
const PAGE_SIZE = 100;
const RECENT_SHOWN = 4;

const countFormat = new Intl.NumberFormat("en-US");

const songs = (count: number) =>
  `${countFormat.format(count)} ${count === 1 ? "song" : "songs"}`;

const RowsSkeleton = ({ rows }: { rows: number }) => (
  <ItemList className="shrink-0" aria-busy aria-label="Loading songs">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton variant="text" className="h-3.5 w-48 max-w-full" />
          <Skeleton variant="text" className="h-3 w-32 max-w-full" />
        </div>
        <Skeleton variant="text" className="h-3 w-20 max-sm:hidden" />
      </div>
    ))}
  </ItemList>
);

export const SongsPageSkeleton = () => (
  <PageShell label="Loading songs" busy>
    <div className="flex flex-col gap-2 max-md:sr-only">
      <Skeleton variant="text" className="h-7 w-24" />
      <Skeleton variant="text" className="h-4 w-80 max-w-full" />
    </div>
    <Skeleton variant="control" className="h-9 w-full max-md:h-10" />
    <RowsSkeleton rows={10} />
  </PageShell>
);

const useSongIntentPrefetch = () => {
  const queryClient = useQueryClient();
  return useIntentPrefetch<string>({
    keyOf: (songId) => songId,
    isFresh: (songId) => {
      const options = createChordChartSongQueryOptions(songId);
      return isQueryFresh(queryClient, options.queryKey, options.staleTime);
    },
    prefetch: async (songId) => {
      await queryClient.query(
        speculativeQuery(createChordChartSongQueryOptions(songId))
      );
    },
  });
};

interface SongRowData {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  /** The latest plan with the song, upcoming ones included; null when it was never on one. */
  readonly lastScheduled: string | null;
  readonly added: string | null;
  /** Songs from this browser's recent list carry no dates. */
  readonly dated: boolean;
}

const toRow = (song: SongLibraryEntry, orgTimeZone: string): SongRowData => ({
  id: song.id,
  title: song.title || "Untitled song",
  author: song.author,
  lastScheduled:
    song.lastScheduledAt === null
      ? null
      : formatCalendarDateLabel(
          song.lastScheduledAt,
          orgTimeZone,
          "monthDayYear"
        ),
  added:
    song.createdAt === null
      ? null
      : `Added ${formatCalendarDateLabel(song.createdAt, orgTimeZone, "monthYear")}`,
  dated: true,
});

const recentRow = (song: RecentSong): SongRowData => ({
  id: song.id,
  title: song.title,
  author: song.author,
  lastScheduled: null,
  added: null,
  dated: false,
});

const joinDetail = (parts: readonly (string | null)[]) =>
  parts.filter((part) => part !== null && part !== "").join(" · ");

const SongRow = ({
  row,
  showPlanningCenterLink,
  getIntentProps,
}: {
  row: SongRowData;
  /** For tidying up: hiding or deleting a song happens in Planning Center. */
  showPlanningCenterLink: boolean;
  getIntentProps: GetIntentPrefetchProps<string>;
}) => {
  const never = row.dated && row.lastScheduled === null;
  const dateLabel = never ? "Never scheduled" : row.lastScheduled;
  return (
    <li className="flex items-center">
      <Link
        to="/songs/$songId"
        params={{ songId: row.id }}
        className="hover:bg-muted/60 focus-visible:bg-muted/60 flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 outline-none"
        {...getIntentProps(row.id)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {row.title}
          </span>
          {/* Phones have no room for the date column, so the date joins the detail line. */}
          <span className="text-muted-foreground block truncate text-xs sm:hidden">
            {joinDetail([dateLabel, never ? row.added : null, row.author])}
          </span>
          <span className="text-muted-foreground block truncate text-xs max-sm:hidden">
            {joinDetail([row.author, never ? row.added : null])}
          </span>
        </span>
        {dateLabel === null ? null : (
          <span
            className={cn(
              "shrink-0 text-xs tabular-nums max-sm:hidden",
              never ? "text-muted-foreground/70" : "text-muted-foreground"
            )}
          >
            {dateLabel}
          </span>
        )}
      </Link>
      {showPlanningCenterLink ? (
        <HoverLabel
          label="Open in Planning Center"
          render={
            <a
              href={planningCenterSongUrl(row.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${row.title} in Planning Center`}
              className={buttonVariants({
                variant: "ghost",
                size: "icon-sm",
                className: "text-muted-foreground mr-1.5 shrink-0",
              })}
            />
          }
        >
          <ExternalLink aria-hidden />
        </HoverLabel>
      ) : null}
    </li>
  );
};

const SongRows = ({
  rows,
  showPlanningCenterLink,
  getIntentProps,
  label,
  columnLabels = false,
}: {
  rows: readonly SongRowData[];
  showPlanningCenterLink: boolean;
  getIntentProps: GetIntentPrefetchProps<string>;
  label: string;
  /** Names the date column above the list. */
  columnLabels?: boolean;
}) => {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const shown = rows.slice(0, limit);
  const remaining = rows.length - shown.length;
  return (
    <>
      {columnLabels ? (
        <div
          aria-hidden
          className={cn(
            "text-muted-foreground -mb-1.5 flex justify-between px-3 text-xs max-sm:hidden",
            // Clears the Planning Center link column.
            showPlanningCenterLink && "pr-12"
          )}
        >
          <span>Song</span>
          <span>Last scheduled</span>
        </div>
      ) : null}
      <ItemList className="shrink-0" render={<ul aria-label={label} />}>
        {shown.map((row) => (
          <SongRow
            key={row.id}
            row={row}
            showPlanningCenterLink={showPlanningCenterLink}
            getIntentProps={getIntentProps}
          />
        ))}
      </ItemList>
      {remaining > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-center"
          onClick={() => {
            setLimit((current) => current + PAGE_SIZE);
          }}
        >
          Show {countFormat.format(Math.min(PAGE_SIZE, remaining))} more
        </Button>
      ) : null}
    </>
  );
};

const describeView = ({
  filter,
  listedCount,
  libraryCount,
  neverCount,
  cutoffLabel,
}: {
  filter: SongLibraryFilter;
  listedCount: number;
  libraryCount: number;
  neverCount: number;
  cutoffLabel: string | null;
}): string => {
  if (filter === "never") {
    return `${songs(listedCount)} ${listedCount === 1 ? "has" : "have"} never been scheduled.`;
  }
  if (cutoffLabel === null) {
    return songs(libraryCount);
  }
  const never =
    neverCount > 0
      ? `, including ${countFormat.format(neverCount)} never scheduled`
      : "";
  return `${countFormat.format(listedCount)} of ${songs(libraryCount)} not used since ${cutoffLabel}${never}.`;
};

const NothingListed = ({
  query,
  filter,
  onAdd,
}: {
  query: string;
  filter: SongLibraryFilter;
  onAdd: () => void;
}) => {
  if (query !== "") {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No songs match “{query}”</EmptyTitle>
          <EmptyDescription>
            {filter === "all"
              ? "Add it to Planning Center to start its chart."
              : "Try All songs, or add it to Planning Center."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onAdd}>
            <Plus aria-hidden />
            Add song
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          {filter === "all" ? "No songs yet" : "Nothing to tidy up"}
        </EmptyTitle>
        <EmptyDescription>
          {filter === "all"
            ? "Add a song to Planning Center to write its chord chart."
            : "Every song has been on a plan in this time."}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};

/** Songs opened in this browser that the cached library may not have yet, such as new ones. */
const useRecentSongs = () => {
  const [stored] = useBrowserStorage(RECENT_SONGS_STORAGE_KEY);
  return useMemo(() => parseRecentSongs(stored), [stored]);
};

/**
 * The organization's song library: open a song to write its chord chart, or find songs no plan
 * has used in a while to hide in Planning Center.
 */
export const SongsPage = ({
  show,
  sort,
}: {
  show: SongLibraryFilter;
  sort: SongLibrarySort;
}) => {
  const navigate = useNavigate({ from: "/songs/" });
  const orgTimeZone = useOrganizationTimeZone();
  // Touch screens would open the keyboard over the list; ask the pointer, not the width.
  const touchScreen = useMediaQuery("(pointer: coarse)");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const deferredQuery = useDeferredValue(query).trim();
  const { data, isPending, isError, isFetching, refetch } = useSongLibrary();
  const { getIntentProps } = useSongIntentPrefetch();
  const recentSongs = useRecentSongs();
  // One "now" per visit keeps the list from reshuffling as the clock moves.
  const now = useMemo(() => currentDate(), []);

  const listed = useMemo(
    () =>
      data === undefined
        ? []
        : selectSongLibrary(
            data.songs,
            { filter: show, sort, query: deferredQuery },
            now
          ),
    [data, deferredQuery, now, show, sort]
  );
  const rows = useMemo(() => {
    const libraryRows = listed.map((song) => toRow(song, orgTimeZone));
    if (deferredQuery === "" || show !== "all" || data === undefined) {
      return libraryRows;
    }
    // A song added in the last hour isn't in the cached library yet.
    const libraryIds = new Set(data.songs.map((song) => song.id));
    const justAdded = matchRecentSongs(recentSongs, deferredQuery).flatMap(
      (song) => (libraryIds.has(song.id) ? [] : [recentRow(song)])
    );
    return [...justAdded, ...libraryRows];
  }, [data, deferredQuery, listed, orgTimeZone, recentSongs, show]);

  const cutoff = songLibraryCutoff(show, now);
  const summary =
    data === undefined || deferredQuery !== ""
      ? null
      : describeView({
          filter: show,
          listedCount: listed.length,
          libraryCount: data.songs.length,
          neverCount: listed.filter((song) => song.lastScheduledAt === null)
            .length,
          cutoffLabel:
            cutoff === null
              ? null
              : formatCalendarDateLabel(cutoff, orgTimeZone, "monthDayYear"),
        });
  const tidying = show !== "all";
  const recentShown =
    !tidying && deferredQuery === "" ? recentSongs.slice(0, RECENT_SHOWN) : [];

  const openAdd = () => {
    setAddOpen(true);
  };

  return (
    <PageShell>
      <header className="flex items-center justify-between gap-3">
        <div className="max-md:sr-only">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            Songs
          </h1>
          <p className="text-muted-foreground text-sm">
            Your Planning Center library. Open a song to write its chord chart.
          </p>
        </div>
        <Button size="sm" className="max-md:ml-auto" onClick={openAdd}>
          <Plus aria-hidden />
          Add song
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={!touchScreen}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search songs, writers, or themes"
            aria-label="Search songs"
          />
        </InputGroup>
        <div className="grid grid-cols-2 gap-2 md:contents">
          <NativeSelect
            aria-label="Which songs"
            value={show}
            onChange={(event) => {
              void navigate({
                search: (current) => ({ ...current, show: event.target.value }),
                replace: true,
              });
            }}
          >
            {songLibraryFilters.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Sort songs"
            value={sort}
            disabled={deferredQuery !== ""}
            onChange={(event) => {
              void navigate({
                search: (current) => ({ ...current, sort: event.target.value }),
                replace: true,
              });
            }}
          >
            {songLibrarySorts.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <LoadingBar
        active={isFetching && data !== undefined}
        className="-my-1.5"
      />

      {recentShown.length > 0 ? (
        <section className="flex flex-col gap-1.5" aria-label="Recently opened">
          <h2 className="text-muted-foreground text-xs font-medium">
            Recently opened
          </h2>
          <SongRows
            rows={recentShown.map(recentRow)}
            showPlanningCenterLink={false}
            getIntentProps={getIntentProps}
            label="Recently opened"
          />
        </section>
      ) : null}

      {summary === null ? null : (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {summary}
          {tidying
            ? " Hiding a song in Planning Center keeps its history and takes it out of search."
            : null}
        </p>
      )}
      {data?.truncated === true ? (
        <p className="text-muted-foreground text-xs">
          Planning Center sent the first {countFormat.format(data.songs.length)}{" "}
          visible songs, A to Z, so later titles aren&apos;t listed.
        </p>
      ) : null}

      {isPending ? <RowsSkeleton rows={10} /> : null}
      {isError && data === undefined ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Songs didn&apos;t load</EmptyTitle>
            <EmptyDescription>
              Planning Center didn&apos;t send the song library.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() => {
                void refetch();
              }}
            >
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
      {data !== undefined && rows.length === 0 ? (
        <NothingListed query={deferredQuery} filter={show} onAdd={openAdd} />
      ) : null}
      {rows.length > 0 ? (
        <SongRows
          // A new view starts back at the first page.
          key={`${show}:${sort}:${deferredQuery}`}
          rows={rows}
          showPlanningCenterLink={tidying}
          getIntentProps={getIntentProps}
          label={deferredQuery === "" ? "Songs" : "Matching songs"}
          columnLabels
        />
      ) : null}

      <AddSongDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialTitle={deferredQuery}
      />
    </PageShell>
  );
};
