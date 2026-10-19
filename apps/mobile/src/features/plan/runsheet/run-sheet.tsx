import { HStack, Host, List, Spacer } from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  background,
  environment,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  refreshable,
  scrollContentBackground,
} from "@expo/ui/swift-ui/modifiers";
import { buildRunSheet } from "@pcobooster/planning-center-models/plan-item-draft";
import { summarizeOrder } from "@pcobooster/planning-center-models/plan-overview";
import { buildPlanInsights } from "@pcobooster/planning-center-models/plan-set-insights";
import type { SongOptionSet } from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";

import { useProductClient } from "../../../app-shell/queries";
import { FloatingGlassBar } from "../../../components/floating-glass-bar";
import { PillButton } from "../../../components/pill-button";
import { AppText } from "../../../design/app-text";
import {
  colors,
  resolvedTokenColor,
  useColorVariant,
} from "../../../design/colors";
import { playHaptic } from "../../../design/haptics";
import { NativeLabel } from "../native-label";
import { isPlaceholderId } from "../placeholder-ids";
import type { PlanToolbar } from "../plan-toolbar";
import { ReadStatus } from "../read-status";
import type { PlanIds } from "../reads";
import {
  itemTitle,
  lengthLabel,
  sectionEnd,
  summaryCounts,
} from "./formatting";
import { ItemEditor } from "./item-editor";
import { songReads } from "./reads";
import { RunSheetRow } from "./rows";
import { SongPalette } from "./song-palette";
import { RunSheetEmptyCard, RunSheetSkeleton } from "./states";
import { RunSheetToolbar } from "./toolbar";
import { TransitionSheet } from "./transition-sheet";
import { useRunSheet } from "./use-run-sheet";

const CachedRow = ({
  ids,
  item,
  ...props
}: Omit<Parameters<typeof RunSheetRow>[0], "options" | "serviceTypeId"> & {
  ids: PlanIds;
}) => {
  const context = useProductClient();
  const cache = useQueryClient();
  const key = songReads.options(
    context,
    ids.serviceTypeId,
    item.song?.id ?? ""
  ).queryKey;
  const options = useSyncExternalStore(
    (changed) => cache.getQueryCache().subscribe(changed),
    () => cache.getQueryData<SongOptionSet>(key)
  );
  return (
    <RunSheetRow
      {...props}
      item={item}
      options={options}
      serviceTypeId={ids.serviceTypeId}
    />
  );
};

export const PlanRunSheet = ({
  ids,
  toolbar,
}: {
  ids: PlanIds;
  toolbar: Parameters<typeof PlanToolbar>[0];
}) => {
  const variant = useColorVariant();
  const {
    query,
    plan,
    writer,
    access,
    selected,
    setSelected,
    palette,
    setPalette,
    transition,
    setTransition,
    reordering,
    setReordering,
    creating,
    removed,
    removals,
    items,
    insert,
    actions,
    save,
  } = useRunSheet(ids);
  if (query.data === undefined) {
    return query.error === null ? (
      <RunSheetSkeleton />
    ) : (
      <View style={{ padding: 16 }}>
        <ReadStatus
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      </View>
    );
  }
  const order = summarizeOrder(items);
  const sheet = buildRunSheet(items);
  const insights = buildPlanInsights(items, plan.data?.sortDate ?? null);
  const selection = items.find((item) => item.id === selected);
  const lastRemoval = removed.at(-1);
  return (
    <View style={{ flex: 1 }}>
      <RunSheetToolbar
        toolbar={toolbar}
        canReorder={access.canEdit && items.length > 1}
        reordering={reordering}
        onReorder={() => {
          setReordering(!reordering);
        }}
      />
      <Host style={{ flex: 1 }}>
        <List
          modifiers={[
            listStyle("plain"),
            scrollContentBackground("hidden"),
            background(resolvedTokenColor("surfaceCanvas", variant)),
            environment("editMode", reordering ? "active" : "inactive"),
            accessibilityIdentifier("run-sheet-list"),
            refreshable(async () => {
              await query.refetch();
            }),
          ]}
        >
          {access.notice === null ? null : (
            <NativeLabel font="meta">{access.notice}</NativeLabel>
          )}
          <HStack
            modifiers={[
              listRowInsets({ top: 8, leading: 16, trailing: 16, bottom: 0 }),
              listRowSeparator("hidden"),
              listRowBackground(resolvedTokenColor("surfaceCanvas", variant)),
            ]}
          >
            <NativeLabel font="meta" color="inkSecondary">
              {summaryCounts(order.songs.length, order.itemCount)}
            </NativeLabel>
            <Spacer />
            <NativeLabel font="meta" color="inkSecondary" tabular>
              {lengthLabel(order.serviceLength)}
            </NativeLabel>
          </HStack>
          <List.ForEach
            data={items}
            keyExtractor={(item) => item.id}
            // Every row renders, as before recycling: rows hold their own swipe and menu state.
            recycling={false}
            onMove={
              access.canEdit
                ? (indices, destination) => {
                    const [index] = indices;
                    const item = items[index];
                    const target =
                      items[
                        Math.max(
                          0,
                          destination > index ? destination - 1 : destination
                        )
                      ];
                    if (item !== undefined && target !== undefined) {
                      removals.flush();
                      playHaptic("tap");
                      void writer.dropItem(item.id, target.id);
                    }
                  }
                : undefined
            }
          >
            {({ item, index }) => (
              <CachedRow
                ids={ids}
                item={item}
                index={index}
                count={items.length}
                canEdit={
                  access.canEdit && !reordering && !isPlaceholderId(item.id)
                }
                canMove={access.canEdit && !isPlaceholderId(item.id)}
                nextIsHeader={items[index + 1]?.itemType === "header"}
                sectionEnd={sectionEnd(items, item.id)}
                sectionLength={sheet.get(item.id)?.sectionLength ?? null}
                recent={insights.recentPlays.get(item.id) ?? null}
                transition={insights.transitions.get(item.id)}
                actions={actions}
              />
            )}
          </List.ForEach>
        </List>
      </Host>
      {items.length === 0 && removed.length === 0 ? (
        <ScrollView
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: colors.surfaceCanvas,
          }}
          contentContainerStyle={{ padding: 16, gap: 16 }}
        >
          {access.notice === null ? null : (
            <AppText font="meta" color={colors.inkSecondary}>
              {access.notice}
            </AppText>
          )}
          <RunSheetEmptyCard
            canEdit={access.canEdit}
            onAdd={(kind) => {
              insert(kind);
            }}
          />
        </ScrollView>
      ) : null}
      {lastRemoval === undefined ? null : (
        <View
          style={{ position: "absolute", bottom: 110, left: 16, right: 16 }}
        >
          <PillButton
            title={`Removed ${itemTitle(lastRemoval)}. Undo`}
            kind="secondary"
            wide
            testID="run-sheet-undo"
            onPress={() => {
              removals.undo(lastRemoval.id);
            }}
          />
        </View>
      )}
      {access.canEdit && !reordering ? (
        <FloatingGlassBar
          alignment="leading"
          actions={[
            {
              id: "header",
              title: "Header",
              systemImage: "textformat",
              showsTitle: false,
              disabled: creating,
              onPress: () => {
                insert("header");
              },
            },
            {
              id: "item",
              title: "Item",
              systemImage: "text.alignleft",
              showsTitle: false,
              disabled: creating,
              onPress: () => {
                insert("item");
              },
            },
            {
              id: "song",
              title: "Add Song",
              systemImage: "music.note",
              showsTitle: false,
              isProminent: true,
              onPress: () => {
                insert("song");
              },
            },
          ]}
        />
      ) : null}
      {selection === undefined ? null : (
        <ItemEditor
          key={selection.id}
          item={selection}
          ids={ids}
          writer={writer}
          canEdit={access.canEdit}
          onClose={() => {
            setSelected(null);
          }}
          onRemove={() => {
            setSelected(null);
            removals.request(selection);
          }}
          onReplace={() => {
            actions.replace(selection);
          }}
        />
      )}
      {palette === null ? null : (
        <SongPalette
          ids={ids}
          writer={writer}
          {...palette}
          onReplaced={(id) => {
            const old = items.find((item) => item.id === id);
            if (old !== undefined) {
              removals.request(old);
            }
          }}
          onClose={() => {
            setPalette(null);
          }}
        />
      )}
      {transition === null ? null : (
        <TransitionSheet
          item={
            items.find((item) => item.id === transition.item.id) ??
            transition.item
          }
          transition={transition.value}
          serviceTypeId={ids.serviceTypeId}
          onKey={(arrangement, key) => {
            actions.key(transition.item, arrangement, key);
            setTransition(null);
          }}
          canEdit={access.canEdit}
          onClose={() => {
            setTransition(null);
          }}
          onNote={(note) => {
            const item =
              items.find((value) => value.id === transition.item.id) ??
              transition.item;
            save(item, {
              description:
                item.description === "" ? note : `${item.description}\n${note}`,
            });
          }}
        />
      )}
    </View>
  );
};
