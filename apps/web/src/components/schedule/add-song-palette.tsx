import { speculativeQuery } from "@pcobooster/client/query";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import {
  formatCompactAgo,
  songPreviewFacts,
} from "@pcobooster/planning-center-models/song-library";
import type { PreviousSong } from "@pcobooster/planning-center-models/song-library";
import type { SongCatalogEntry } from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft } from "lucide-react";
import { useDeferredValue, useState } from "react";
import type { ReactNode } from "react";

import { SongHistory } from "@/components/schedule/song-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import type { IntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSettledValue } from "@/hooks/use-settled-value";
import { useSongHistory } from "@/hooks/use-song-history";
import {
  createSongOptionsQueryOptions,
  useSongOptions,
} from "@/hooks/use-song-options";
import { useSongSearch } from "@/hooks/use-song-search";
import { useSongSuggestions } from "@/hooks/use-song-suggestions";
import { currentDate } from "@/lib/clock";
import { isQueryFresh } from "@/lib/intent-prefetch";
import { cn } from "@/lib/utils";

/** How long a highlighted song must stay highlighted before its preview loads. */
const PREVIEW_SETTLE_MS = 250;
/** History rows the preview shows before "Show all". */
const PREVIEW_HISTORY_ROWS = 8;
/** Wide enough for the preview beside the list; narrower screens preview on tap. */
const SIDE_PREVIEW_QUERY = "(min-width: 768px)";

const Property = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <>
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="min-w-0 text-sm">{children}</dd>
  </>
);

/** "3w" before the service, or "later" when it's already planned after it. */
const whenLabel = (song: SongCatalogEntry, planDate: Date) => {
  if (song.lastScheduledAt === null) {
    return "";
  }
  return song.lastScheduledAt > planDate
    ? "later"
    : formatCompactAgo(song.lastScheduledAt, planDate);
};

/** What matters while choosing a song: its keys, tempo, and where it's been sung. */
const SongPreview = ({
  song,
  serviceTypeId,
  planId,
  planDate,
  previousSong,
  onOpenPlan,
}: {
  song: SongCatalogEntry;
  serviceTypeId: string | null;
  planId: string | null;
  planDate: Date;
  previousSong: PreviousSong | null;
  onOpenPlan: () => void;
}) => {
  const history = useSongHistory(song.id);
  const options = useSongOptions(song.id, serviceTypeId);
  const { keys, tempos, keyChange } = songPreviewFacts({
    history: history.data?.entries,
    arrangements: options.data?.arrangements ?? [],
    serviceTypeId,
    previousSong,
    planDate,
  });
  const optionsPending = options.isLoading && options.data === undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-sm font-medium">{song.title}</p>
        {song.author === "" ? null : (
          <p className="text-muted-foreground truncate text-xs">
            {song.author}
          </p>
        )}
      </div>
      {optionsPending ? (
        <div className="flex flex-col gap-2.5" aria-busy>
          <Skeleton variant="text" className="h-3.5 w-3/5" />
          <Skeleton variant="text" className="h-3.5 w-2/5" />
        </div>
      ) : (
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          {keys.length === 0 ? null : (
            <Property label="Keys">
              <span className="flex flex-wrap gap-1">
                {keys.map((key) => (
                  <Badge key={key} variant="outline">
                    {key}
                  </Badge>
                ))}
              </span>
            </Property>
          )}
          {tempos.length === 0 ? null : (
            <Property label="Tempo">{tempos.join(", ")}</Property>
          )}
          {keyChange === null || previousSong === null ? null : (
            <Property label={`After ${previousSong.endKey}`}>
              {keyChange.key}, {keyChange.change}
            </Property>
          )}
        </dl>
      )}
      <SongHistory
        songId={song.id}
        serviceTypeId={serviceTypeId}
        planId={planId}
        planDate={planDate}
        previewRows={PREVIEW_HISTORY_ROWS}
        onOpenPlan={onOpenPlan}
      />
    </div>
  );
};

const PaletteSongRow = ({
  song,
  inPlan,
  pending,
  planDate,
  intentProps,
  onAdd,
}: {
  song: SongCatalogEntry;
  inPlan: boolean;
  pending: boolean;
  planDate: Date;
  intentProps: IntentPrefetchProps;
  onAdd: (song: SongCatalogEntry) => void;
}) => (
  <CommandItem
    value={song.id}
    disabled={pending}
    {...intentProps}
    onSelect={() => {
      onAdd(song);
    }}
  >
    <span className="min-w-0 flex-1 truncate">{song.title}</span>
    <span
      data-slot="command-shortcut"
      className="text-muted-foreground shrink-0 text-xs font-normal tabular-nums"
    >
      {inPlan ? (
        <Check className="size-3.5" aria-label="In plan" />
      ) : (
        whenLabel(song, planDate)
      )}
    </span>
  </CommandItem>
);

/**
 * cmdk leaves nothing highlighted when results change under it, so Enter would do
 * nothing; fall back to the first song not in the plan yet.
 */
const activeSongOf = (
  songs: readonly SongCatalogEntry[],
  highlightedSongId: string,
  planSongIds: ReadonlySet<string>
): string => {
  if (songs.some((song) => song.id === highlightedSongId)) {
    return highlightedSongId;
  }
  return (
    songs.find((song) => !planSongIds.has(song.id))?.id ?? songs[0]?.id ?? ""
  );
};

/** A song whose arrangements and keys are known before it's added lands with them. */
const useSongOptionsIntent = (serviceTypeId: string | null) => {
  const queryClient = useQueryClient();
  const { getIntentProps } = useIntentPrefetch<string>({
    keyOf: (songId) => songId,
    isFresh: (songId) => {
      if (!isNonEmptyString(serviceTypeId)) {
        return true;
      }
      const options = createSongOptionsQueryOptions(songId, serviceTypeId);
      return isQueryFresh(queryClient, options.queryKey, options.staleTime);
    },
    prefetch: async (songId) => {
      if (!isNonEmptyString(serviceTypeId)) {
        return;
      }
      await queryClient.query(
        speculativeQuery(createSongOptionsQueryOptions(songId, serviceTypeId))
      );
    },
  });
  return getIntentProps;
};

const PaletteFooter = () => (
  <div className="text-muted-foreground flex items-center gap-4 px-4 py-2.5 text-xs pointer-coarse:hidden">
    <span className="flex items-center gap-1.5">
      <KbdGroup>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
      </KbdGroup>
      Navigate
    </span>
    <span className="flex items-center gap-1.5">
      <Kbd>↵</Kbd>
      Choose
    </span>
    <span className="flex items-center gap-1.5">
      <Kbd>Esc</Kbd>
      Close
    </span>
  </div>
);

/**
 * On a phone, a tapped song's preview takes the list's place, with a way back and a
 * button that adds it.
 */
const TappedSongPreview = ({
  song,
  pending,
  onBack,
  onAdd,
  ...previewProps
}: {
  song: SongCatalogEntry;
  pending: boolean;
  onBack: () => void;
  onAdd: (song: SongCatalogEntry) => void;
  serviceTypeId: string | null;
  planId: string | null;
  planDate: Date;
  previousSong: PreviousSong | null;
  onOpenPlan: () => void;
}) => (
  <div className="flex h-[min(34rem,60svh)] min-h-0 flex-col">
    <div className="p-1">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeft />
        Songs
      </Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <SongPreview song={song} {...previewProps} />
    </div>
    <div className="p-3">
      <Button
        type="button"
        className="h-11 w-full"
        disabled={pending}
        onClick={() => {
          onAdd(song);
        }}
      >
        Add to plan
      </Button>
    </div>
  </div>
);

interface AddSongPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceTypeId: string | null;
  planId: string | null;
  /** The plan's service date, which times and history are counted from. */
  planDate: Date | null;
  /** The song a new one would follow, for how its key sits against it. */
  previousSong: PreviousSong | null;
  planSongIds: ReadonlySet<string>;
  pendingSongId: string | null;
  onChooseSong: (song: SongCatalogEntry) => void;
}

/**
 * Choosing a song: search, or browse what was sung most recently, with the highlighted
 * song's keys, tempo, and history beside the list. Enter chooses it and closes.
 */
export const AddSongPalette = ({
  open,
  onOpenChange,
  serviceTypeId,
  planId,
  planDate,
  previousSong,
  planSongIds,
  pendingSongId,
  onChooseSong,
}: AddSongPaletteProps) => {
  const [query, setQuery] = useState("");
  const [highlightedSongId, setHighlightedSongId] = useState("");
  const [tappedSong, setTappedSong] = useState<SongCatalogEntry | null>(null);
  const sidePreview = useMediaQuery(SIDE_PREVIEW_QUERY);
  const deferredQuery = useDeferredValue(query).trim();
  const search = useSongSearch(deferredQuery);
  const suggestions = useSongSuggestions();
  const serviceDate = planDate ?? currentDate();
  const browsing = deferredQuery === "";
  const songs = browsing
    ? [
        ...(suggestions.data?.recentlyPlayed ?? []),
        ...(suggestions.data?.resting ?? []),
      ]
    : (search.data ?? []);
  const activeSongId = activeSongOf(songs, highlightedSongId, planSongIds);
  const previewSongId = useSettledValue(activeSongId, PREVIEW_SETTLE_MS);
  const previewSong = songs.find((song) => song.id === previewSongId) ?? null;
  const loading = browsing
    ? suggestions.data === undefined && !suggestions.isError
    : search.isLoading && search.data === undefined;
  const getIntentProps = useSongOptionsIntent(serviceTypeId);

  /** Closing starts the next search fresh. */
  const setOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery("");
      setHighlightedSongId("");
      setTappedSong(null);
    }
    onOpenChange(nextOpen);
  };
  const chooseAndClose = (song: SongCatalogEntry) => {
    onChooseSong(song);
    setOpen(false);
  };
  const close = () => {
    setOpen(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Add song"
      description="Search the song catalog"
      className="sm:max-w-2xl"
    >
      {tappedSong === null ? null : (
        <TappedSongPreview
          key={tappedSong.id}
          song={tappedSong}
          pending={pendingSongId === tappedSong.id}
          onBack={() => {
            setTappedSong(null);
          }}
          onAdd={chooseAndClose}
          serviceTypeId={serviceTypeId}
          planId={planId}
          planDate={serviceDate}
          previousSong={previousSong}
          onOpenPlan={close}
        />
      )}
      <Command
        className={cn(tappedSong !== null && "hidden")}
        shouldFilter={false}
        value={activeSongId}
        onValueChange={setHighlightedSongId}
        label="Add song"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search songs"
          autoFocus
        />
        <div
          className={cn(
            "mt-1 grid h-[min(26rem,60svh)] grid-cols-1",
            previewSong !== null && "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          )}
        >
          <CommandList className="max-h-none">
            {loading ? (
              <div className="flex flex-col gap-3 p-4" aria-busy>
                <Skeleton variant="text" className="h-3.5 w-3/4" />
                <Skeleton variant="text" className="h-3.5 w-1/2" />
                <Skeleton variant="text" className="h-3.5 w-2/3" />
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {browsing
                    ? "No songs sung recently. Search your library to add one."
                    : `No songs match “${deferredQuery}”.`}
                </CommandEmpty>
                <CommandGroup heading={browsing ? "Recently sung" : undefined}>
                  {songs.map((song) => (
                    <PaletteSongRow
                      key={song.id}
                      song={song}
                      inPlan={planSongIds.has(song.id)}
                      pending={pendingSongId === song.id}
                      planDate={serviceDate}
                      intentProps={getIntentProps(song.id)}
                      onAdd={sidePreview ? chooseAndClose : setTappedSong}
                    />
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
          {previewSong === null ? null : (
            <div className="animate-in fade-in-0 slide-in-from-right-2 border-border/60 hidden min-w-0 overflow-y-auto overscroll-contain border-l duration-150 ease-out motion-reduce:animate-none md:block">
              <SongPreview
                key={previewSong.id}
                song={previewSong}
                serviceTypeId={serviceTypeId}
                planId={planId}
                planDate={serviceDate}
                previousSong={previousSong}
                onOpenPlan={close}
              />
            </div>
          )}
        </div>
        <Separator />
        <PaletteFooter />
      </Command>
    </CommandDialog>
  );
};
