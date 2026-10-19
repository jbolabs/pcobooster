import { callForQuery } from "@pcobooster/client/query";
import { createOptimisticSongPlanItem } from "@pcobooster/planning-center-models/plan-item-order";
import type { PlanInsertion } from "@pcobooster/planning-center-models/plan-item-order";
import {
  previousSongBefore,
  songPreviewFacts,
} from "@pcobooster/planning-center-models/song-library";
import type { PreviousSong } from "@pcobooster/planning-center-models/song-library";
import type { SongCatalogEntry } from "@pcobooster/planning-center-models/types";
import {
  keepPreviousData,
  queryOptions,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { useProductClient } from "../../../app-shell/queries";
import { useVisibleQuery as useQuery } from "../../../app-shell/visible-queries";
import { EmptyState } from "../../../components/empty-state";
import { KeyBadge } from "../../../components/key-badge";
import { AppText } from "../../../design/app-text";
import { colors } from "../../../design/colors";
import type { PlanContentWriter } from "../content-writes";
import { EditorSection, EditorSheet } from "../editor-sheet";
import { ReadStatus } from "../read-status";
import { planReads } from "../reads";
import type { PlanIds } from "../reads";
import { songReads } from "./reads";
import { previewFactRows } from "./song-facts";
import { SongHistory, usePlanDate } from "./song-history";

/** History rows the song preview shows before "Show All". */
const PREVIEW_HISTORY_ROWS = 8;

interface PaletteContext {
  ids: PlanIds;
  planDate: Date;
  /** The song a chosen one would follow, for how its key sits against it. */
  previousSong: PreviousSong | null;
  planSongIds: ReadonlySet<string>;
  actionTitle: string;
}

/** What matters while choosing a song: the keys it was sung in, its tempos, how its key meets
 * the song before, and where it was sung. Facts only; the action sits at the bottom. */
const SongPreview = ({
  song,
  palette,
  busy,
  onChoose,
  onClose,
}: {
  song: SongCatalogEntry;
  palette: PaletteContext;
  busy: boolean;
  onChoose: () => void;
  onClose: () => void;
}) => {
  const context = useProductClient();
  const { ids } = palette;
  const options = useQuery(
    songReads.options(context, ids.serviceTypeId, song.id)
  );
  const history = useQuery(songReads.schedule(context, song.id));
  const facts = previewFactRows(
    songPreviewFacts({
      history: history.data?.entries,
      arrangements: options.data?.arrangements ?? [],
      serviceTypeId: ids.serviceTypeId,
      previousSong: palette.previousSong,
      planDate: palette.planDate,
    }),
    palette.previousSong
  );
  return (
    <EditorSheet
      title={song.title}
      onClose={onClose}
      actions={[
        {
          title: palette.actionTitle,
          role: "prominent",
          onPress: onChoose,
          disabled: busy,
          testID: "song-palette-add",
        },
      ]}
    >
      <AppText font="pageTitle">{song.title}</AppText>
      {song.author === "" ? null : (
        <AppText color={colors.inkSecondary} font="rowDetail">
          {song.author}
        </AppText>
      )}
      {palette.planSongIds.has(song.id) ? (
        <AppText font="meta" color={colors.inkSecondary}>
          ✓ Already in this plan
        </AppText>
      ) : null}
      <EditorSection title="Facts">
        {options.data === undefined && options.error === null ? (
          <ReadStatus error={null} />
        ) : (
          <>
            {facts.empty ? (
              <AppText font="rowDetail" color={colors.inkSecondary}>
                No keys or tempo in Planning Center yet.
              </AppText>
            ) : null}
            {facts.keys.length === 0 ? null : (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <AppText font="rowDetail" color={colors.inkSecondary}>
                  Keys
                </AppText>
                <View
                  testID="song-preview-keys"
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                    gap: 4,
                  }}
                >
                  {facts.keys.map((key) => (
                    <KeyBadge key={key} songKey={key} />
                  ))}
                </View>
              </View>
            )}
            {facts.rows.map((row) => (
              <View
                key={row.label}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <AppText font="rowDetail" color={colors.inkSecondary}>
                  {row.label}
                </AppText>
                <AppText font="rowDetail" style={{ flexShrink: 1 }}>
                  {row.value}
                </AppText>
              </View>
            ))}
          </>
        )}
      </EditorSection>
      <SongHistory
        songId={song.id}
        ids={ids}
        planDate={palette.planDate}
        previewRows={PREVIEW_HISTORY_ROWS}
      />
    </EditorSheet>
  );
};

/** A palette read's state: its songs (kept while a newer search loads), else its failure, else loading. */
const SongRows = ({
  query,
  title,
  onSelect,
}: {
  query: {
    data: SongCatalogEntry[] | undefined;
    error: Error | null;
    retry: () => void;
  };
  title: string;
  onSelect: (song: SongCatalogEntry) => void;
}) => {
  if (query.data === undefined) {
    return <ReadStatus error={query.error} retry={query.retry} />;
  }
  if (query.data.length === 0) {
    return null;
  }
  return (
    <EditorSection title={title}>
      {query.data.map((song) => (
        <Pressable
          key={song.id}
          accessibilityRole="button"
          testID={`song-palette-row-${song.id}`}
          onPress={() => {
            onSelect(song);
          }}
          style={{ minHeight: 44, paddingVertical: 8 }}
        >
          <AppText font="rowTitle">{song.title}</AppText>
          <AppText font="meta" color={colors.inkSecondary}>
            {song.author}
          </AppText>
        </Pressable>
      ))}
    </EditorSection>
  );
};

export const SongPalette = ({
  ids,
  writer,
  insertion,
  replacing,
  onClose,
  onReplaced,
}: {
  ids: PlanIds;
  writer: PlanContentWriter;
  insertion?: PlanInsertion;
  replacing?: string;
  onClose: () => void;
  onReplaced: (id: string) => void;
}) => {
  const context = useProductClient();
  const cache = useQueryClient();
  const planDate = usePlanDate(ids);
  const items = useQuery(planReads.items(context, ids));
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<SongCatalogEntry | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query.trim().toLowerCase());
    }, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);
  const search = useQuery({
    ...songReads.search(context, debounced),
    enabled: debounced !== "",
    placeholderData: keepPreviousData,
  });
  const recent = useQuery(
    queryOptions({
      queryKey: [context.scope, "songs.suggestions"],
      queryFn: async (request) =>
        await callForQuery(request, context.client, (api) =>
          api.songs.suggestions()
        ),
      enabled: debounced === "",
    })
  );
  const planItems = items.data ?? [];
  const palette: PaletteContext = {
    ids,
    planDate,
    previousSong: previousSongBefore(planItems, insertion?.afterItemId ?? null),
    planSongIds: new Set(
      planItems.flatMap((item) => (item.song === null ? [] : [item.song.id]))
    ),
    actionTitle: replacing === undefined ? "Add to Plan" : "Replace",
  };
  /** Adds the song with the arrangement, key, layout and length its loaded options suggest;
   * without them Planning Center's defaults apply on the server. */
  const choose = (song: SongCatalogEntry) => {
    setBusy(true);
    void (async () => {
      const options = cache.getQueryData(
        songReads.options(context, ids.serviceTypeId, song.id).queryKey
      );
      const suggested = options?.arrangements.find(
        (value) => value.id === options.suggestedArrangementId
      );
      const created = await writer.createItem(
        {
          songId: song.id,
          title: options?.song.title ?? song.title,
          arrangementId: options?.suggestedArrangementId ?? undefined,
          keyId: options?.suggestedKeyId ?? undefined,
          selectedLayoutId: options?.suggestedLayoutId ?? undefined,
          length:
            suggested?.length === null || suggested?.length === undefined
              ? undefined
              : Math.round(suggested.length),
        },
        createOptimisticSongPlanItem(`optimistic-song-${song.id}`, song, 0),
        insertion
      );
      if (created === null) {
        setBusy(false);
        return;
      }
      if (replacing !== undefined) {
        onReplaced(replacing);
      }
      onClose();
    })();
  };
  if (selected !== null) {
    return (
      <SongPreview
        song={selected}
        palette={palette}
        busy={busy}
        onChoose={() => {
          choose(selected);
        }}
        onClose={onClose}
      />
    );
  }
  const browsing = debounced === "";
  const retryRecent = () => {
    void recent.refetch();
  };
  return (
    <EditorSheet
      title={replacing === undefined ? "Add Song" : "Replace Song"}
      onClose={onClose}
    >
      <TextInput
        accessibilityLabel="Search songs"
        testID="song-search-field"
        placeholder="Search songs"
        style={{
          padding: 12,
          borderRadius: 12,
          color: colors.ink,
          backgroundColor: colors.surfaceSecondary,
          fontSize: 17,
        }}
        value={query}
        onChangeText={setQuery}
      />
      {browsing ? (
        <>
          {recent.data?.recentlyPlayed.length === 0 &&
          recent.data.resting.length === 0 ? (
            <EmptyState
              artwork="songs"
              title="No songs sung yet"
              description="Search the library to add a song."
            />
          ) : null}
          <SongRows
            query={{
              data: recent.data?.recentlyPlayed,
              error: recent.error,
              retry: retryRecent,
            }}
            title="Recently sung"
            onSelect={setSelected}
          />
          {recent.data === undefined ? null : (
            <SongRows
              query={{
                data: recent.data.resting,
                error: null,
                retry: retryRecent,
              }}
              title="Earlier"
              onSelect={setSelected}
            />
          )}
        </>
      ) : (
        <>
          {search.data?.length === 0 && !search.isFetching ? (
            <EmptyState
              artwork="search"
              title={`No results for "${query.trim()}"`}
              description="Check the spelling or try a new search."
            />
          ) : null}
          <SongRows
            query={{
              data: search.data,
              error: search.error,
              retry: () => {
                void search.refetch();
              },
            }}
            title="Search results"
            onSelect={setSelected}
          />
        </>
      )}
    </EditorSheet>
  );
};
