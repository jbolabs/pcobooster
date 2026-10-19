import { closestCenter, DndContext, DragOverlay } from "@dnd-kit/core";
import { appendNote } from "@pcobooster/planning-center-models/key-transition-advice";
import {
  buildDraft,
  buildRunSheet,
} from "@pcobooster/planning-center-models/plan-item-draft";
import type { RunSheetEntry } from "@pcobooster/planning-center-models/plan-item-draft";
import type { PlanInsertion } from "@pcobooster/planning-center-models/plan-item-order";
import { buildPlanInsights } from "@pcobooster/planning-center-models/plan-set-insights";
import type { PlanInsights } from "@pcobooster/planning-center-models/plan-set-insights";
import { previousSongBefore } from "@pcobooster/planning-center-models/song-library";
import type {
  PlanItem,
  SongCatalogEntry,
} from "@pcobooster/planning-center-models/types";
import { startTransition, useRef, useState } from "react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { toast } from "sonner";

import { PageScrollArea } from "@/components/page-shell";
import { QueryDataBoundary } from "@/components/query-data-boundary";
import { AddSongPalette } from "@/components/schedule/add-song-palette";
import { PlanFileDialog } from "@/components/schedule/plan-file-dialog";
import {
  PlanItemList,
  PlanItemListEmpty,
  PlanItemListSkeleton,
  PlanItemRow,
} from "@/components/schedule/plan-item-list";
import type { PlanItemRowHandlers } from "@/components/schedule/plan-item-list";
import { PlanItemPane } from "@/components/schedule/plan-item-pane";
import type { PlanItemSaveInput } from "@/components/schedule/plan-item-pane";
import { PlanTabToolbar } from "@/components/schedule/plan-tab-toolbar";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useDismissOnOutsidePress } from "@/hooks/use-dismiss-on-outside-press";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePlanBuilderDrag } from "@/hooks/use-plan-builder-drag";
import { usePlanBuilderHotkeys } from "@/hooks/use-plan-builder-hotkeys";
import { usePlanFileDialog } from "@/hooks/use-plan-file-dialog";
import type { PlanFileDialogControl } from "@/hooks/use-plan-file-dialog";
import {
  isOptimisticItemId,
  usePlanTabController,
} from "@/hooks/use-plan-tab-controller";
import type { AddedPlanItemKind } from "@/hooks/use-plan-tab-controller";
import { useRevealOnLoad } from "@/hooks/use-reveal-on-load";
import { currentDate } from "@/lib/clock";
import { songItemsOf } from "@/lib/plan-file-dialog";
import {
  restrictToVerticalAxis,
  sortableDropAnimation,
} from "@/lib/sortable-motion";
import { cn } from "@/lib/utils";

interface PlanTabProps {
  serviceTypeId: string | null;
  planId: string | null;
  /** The plan's date, for spotting songs sung in the weeks before it. */
  planDate: Date | null;
}

/** The run sheet only reorders up and down. */
const verticalOnly = [restrictToVerticalAxis];

/**
 * Presses here leave the details open: rows switch them to themselves, and the toolbar
 * adds after the selection. Closing would also slide the toolbar out from under the press.
 */
const KEEPS_DETAILS_OPEN = "[data-plan-item-id], [data-plan-toolbar]";

/** The details slide in beside the run sheet only where there is room for both. */
const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";

/** Runs a plan write; mutations report their own failures and restore the plan. */
const runQuietly = (task: () => Promise<void>) => {
  startTransition(async () => {
    try {
      await task();
    } catch {
      // Already reported by the mutation's error toast.
    }
  });
};

/** A run sheet row's focusable surface. */
const rowFocusTarget = (itemId: string) =>
  document
    .querySelector<HTMLElement>(`[data-plan-item-id="${CSS.escape(itemId)}"]`)
    ?.querySelector<HTMLElement>('[data-slot="item"]') ?? null;
/**
 * Runs a reorder urgently, outside a transition, so the new order renders with the drop
 * instead of after it; mutations report their own failures and restore the plan.
 */
const reorderNow = (task: () => Promise<void>) => {
  void (async () => {
    try {
      await task();
    } catch {
      // Already reported by the mutation's error toast.
    }
  })();
};

const focusRow = (itemId: string) => {
  requestAnimationFrame(() => {
    const target = rowFocusTarget(itemId);
    target?.scrollIntoView({ block: "nearest" });
    target?.focus({ preventScroll: true });
  });
};

const PlanBuilderDragPreview = ({
  item,
  entry,
  insights,
  serviceTypeId,
  handlers,
}: {
  item: PlanItem | null;
  entry: RunSheetEntry | undefined;
  insights: PlanInsights;
  serviceTypeId: string | null;
  handlers: PlanItemRowHandlers;
}) => (
  <DragOverlay zIndex={60} dropAnimation={sortableDropAnimation}>
    {item ? (
      <div className="bg-background rotate-[0.2deg] rounded-lg shadow-2xl">
        <PlanItemRow
          item={item}
          entry={entry}
          transition={insights.transitions.get(item.id) ?? null}
          recentPlayDays={insights.recentPlays.get(item.id) ?? null}
          selected={false}
          isBusy={false}
          isDragged
          serviceTypeId={serviceTypeId}
          handlers={handlers}
        />
      </div>
    ) : null}
  </DragOverlay>
);

/** Saves a key or length picked on a row or in the details. */
const inlineEditHandlers = (
  saveItem: (input: PlanItemSaveInput) => Promise<void>
): Pick<
  PlanItemRowHandlers,
  "onChangeKey" | "onChangeLength" | "onAddNote" | "onInvalidLength"
> => ({
  onChangeKey: (item, arrangement, key) => {
    runQuietly(async () => {
      await saveItem({
        item,
        draft: {
          ...buildDraft(item),
          arrangementId: arrangement.id,
          keyId: key.id,
        },
        length: item.length,
        optimisticArrangement: {
          id: arrangement.id,
          name: arrangement.name,
          sequence: arrangement.sequence,
          length: arrangement.length,
          archivedAt: null,
        },
        optimisticKey: key,
      });
    });
  },
  onChangeLength: (item, length) => {
    runQuietly(async () => {
      await saveItem({
        item,
        draft: buildDraft(item),
        length,
        optimisticArrangement: item.arrangement,
        optimisticKey: item.key,
      });
    });
  },
  onAddNote: (item, note) => {
    runQuietly(async () => {
      await saveItem({
        item,
        draft: {
          ...buildDraft(item),
          description: appendNote(item.description, note),
        },
        length: item.length,
        optimisticArrangement: item.arrangement,
        optimisticKey: item.key,
      });
    });
  },
  onInvalidLength: (message) => {
    toast.error(message);
  },
});

/** The song right before `item` in its section, for how their keys meet. */
const songBefore = (items: readonly PlanItem[], item: PlanItem) => {
  const before = items[items.findIndex((other) => other.id === item.id) - 1];
  return before === undefined ? null : previousSongBefore(items, before.id);
};

/** The item whose details show: the selection once it exists in Planning Center. */
const detailItemOf = (detailsOpen: boolean, selectedItem: PlanItem | null) =>
  detailsOpen && selectedItem !== null && !isOptimisticItemId(selectedItem.id)
    ? selectedItem
    : null;

/** What the song dialog needs: the song a chosen one would follow, and what's in the plan. */
const paletteContextOf = (
  items: readonly PlanItem[],
  selectedItem: PlanItem | null
) => ({
  previousSong: previousSongBefore(items, selectedItem?.id ?? null),
  planSongIds: new Set(
    items.flatMap((item) => (item.song === null ? [] : [item.song.id]))
  ),
});

const PlanRunSheet = ({
  isLoading,
  revealClassName,
  items,
  onAddSong,
  onAddBasic,
  ...listProps
}: Omit<ComponentProps<typeof PlanItemList>, "items"> & {
  isLoading: boolean;
  revealClassName: string | undefined;
  items: PlanItem[];
  onAddSong: () => void;
  onAddBasic: (kind: "header" | "item") => void;
}) => {
  if (isLoading) {
    return <PlanItemListSkeleton />;
  }
  if (items.length === 0) {
    return (
      <PlanItemListEmpty
        onAddSong={onAddSong}
        onAddHeader={() => {
          onAddBasic("header");
        }}
        onAddItem={() => {
          onAddBasic("item");
        }}
      />
    );
  }
  return (
    <div className={cn("relative pb-20", revealClassName)}>
      <PlanItemList items={items} {...listProps} />
    </div>
  );
};

/**
 * The details beside the run sheet on wide screens. Closing mirrors opening: the run
 * sheet takes the room back at once while the last details fade out over it.
 */
const DetailsAside = ({
  ref,
  pane,
}: {
  ref: RefObject<HTMLElement | null>;
  pane: ReactNode;
}) => {
  const [lastPane, setLastPane] = useState<ReactNode>(pane);
  if (pane !== null && pane !== lastPane) {
    setLastPane(pane);
  }
  const closing = pane === null;
  if (closing && lastPane === null) {
    return null;
  }
  return (
    <aside
      ref={ref}
      aria-label="Details"
      className={cn(
        "flex min-h-0 w-[min(24rem,34vw)] shrink-0 flex-col pb-4 ease-out",
        closing
          ? "animate-out fade-out-0 slide-out-to-right-4 fill-mode-forwards pointer-events-none absolute inset-y-0 right-0 duration-150"
          : "animate-in fade-in-0 slide-in-from-right-4 pointer-events-none duration-200 *:pointer-events-auto motion-reduce:animate-none"
      )}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) {
          setLastPane(null);
        }
      }}
    >
      {closing ? lastPane : pane}
    </aside>
  );
};

/** The details as a sheet, on screens too narrow to slide them in beside the run sheet. */
const DetailsSheet = ({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) => (
  <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
    <ResponsiveDialogContent mobileClassName="max-h-[85svh]">
      <ResponsiveDialogHeader className="sr-only">
        <ResponsiveDialogTitle>Details</ResponsiveDialogTitle>
      </ResponsiveDialogHeader>
      <div className="flex min-h-0 flex-col px-3 pb-3">{children}</div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
);

/** Plan hotkeys wait while loading, dragging, or a dialog is up. */
const nothingInTheWay = (blockers: boolean[]) => !blockers.includes(true);

/** Blurs the focused field inside `container`, so it saves before the container unmounts. */
const blurWithin = (container: HTMLElement | null) => {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && container?.contains(focused) === true) {
    focused.blur();
  }
};

/** Confirms removing a run sheet item before it comes off the plan. */
const RemoveItemDialog = ({
  item,
  onCancel,
  onConfirm,
}: {
  item: PlanItem | null;
  onCancel: () => void;
  onConfirm: (itemId: string) => void;
}) => (
  <DeleteConfirmationDialog
    open={item !== null}
    onOpenChange={(open) => {
      if (!open) {
        onCancel();
      }
    }}
    onConfirm={() => {
      if (item !== null) {
        onConfirm(item.id);
      }
    }}
    title={`Remove “${item === null || item.title === "" ? "Untitled item" : item.title}”?`}
    description="It comes off this plan in Planning Center."
    confirmLabel="Remove"
  />
);

/** The file dialog over the plan, stepping through its saved songs. */
const PlanFiles = ({
  items,
  serviceTypeId,
  planId,
  dialog,
}: Pick<PlanTabProps, "serviceTypeId" | "planId"> & {
  items: readonly PlanItem[];
  dialog: PlanFileDialogControl;
}) => {
  if (serviceTypeId === null || planId === null) {
    return null;
  }
  const saved = items.filter((item) => !isOptimisticItemId(item.id));
  return (
    <PlanFileDialog
      items={saved}
      songs={songItemsOf(saved)}
      serviceTypeId={serviceTypeId}
      planId={planId}
      state={dialog.state}
      onStateChange={dialog.handleChange}
      finalFocus={dialog.finalFocus}
    />
  );
};

/**
 * The plan builder: the run sheet, with an opened row's details sliding in beside it.
 * New songs come from the add-song dialog and land after the selected row.
 */
export const PlanTab = ({ serviceTypeId, planId, planDate }: PlanTabProps) => {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  // Details follow the selection while open; nothing is reserved for them while closed.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // A header or item just added, whose title is selected so typing names it.
  const [titleFocusItemId, setTitleFocusItemId] = useState<string | null>(null);
  // The item waiting on the remove confirmation, if any.
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const paneRef = useRef<HTMLElement>(null);
  const isWide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const onItemAdded = (itemId: string, kind: AddedPlanItemKind) => {
    setSelectedItemId(itemId);
    if (kind !== "song" && !isOptimisticItemId(itemId)) {
      setTitleFocusItemId(itemId);
      setDetailsOpen(true);
    }
  };
  const controller = usePlanTabController({
    serviceTypeId,
    planId,
    onItemAdded,
  });
  const { items, isLoading, planItemsQuery, songPickerOpen, saveItem } =
    controller;
  const initialLoadFailed =
    planItemsQuery.data === undefined && planItemsQuery.error !== null;
  const revealClassName = useRevealOnLoad(isLoading);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const runSheet = buildRunSheet(items);
  const insights = buildPlanInsights(items, planDate);
  const insertion: PlanInsertion | undefined =
    selectedItem === null ? undefined : { afterItemId: selectedItem.id };

  const addBasicItem = (kind: "header" | "item", at = insertion) => {
    runQuietly(async () => {
      await controller.createBasicItem(kind, at);
    });
  };
  const openSongPicker = () => {
    controller.setSongPickerOpen(true);
  };
  const chooseSong = (song: SongCatalogEntry) => {
    runQuietly(async () => {
      await controller.addSongToPlan(song, insertion);
    });
  };
  const select = (itemId: string | null) => {
    setSelectedItemId(itemId);
    setTitleFocusItemId(null);
  };
  const fileDialog = usePlanFileDialog(select, rowFocusTarget);
  const selectAndFocus = (itemId: string | null) => {
    select(itemId);
    if (itemId !== null) {
      focusRow(itemId);
    }
  };
  const openDetails = (itemId: string) => {
    select(itemId);
    setDetailsOpen(true);
  };
  const closeDetails = () => {
    blurWithin(paneRef.current);
    setDetailsOpen(false);
    if (selectedItemId !== null) {
      focusRow(selectedItemId);
    }
  };
  const handleConfirmRemove = (itemId: string) => {
    setRemovingItemId(null);
    const index = items.findIndex((item) => item.id === itemId);
    const neighbor = items[index + 1] ?? items[index - 1] ?? null;
    controller.removeItem(itemId);
    if (selectedItemId === itemId) {
      select(neighbor?.id ?? null);
    }
    if (neighbor === null) {
      setDetailsOpen(false);
    }
  };

  const drag = usePlanBuilderDrag({
    items,
    onReorder: (nextItems) => {
      reorderNow(async () => {
        await controller.reorderItems(nextItems);
      });
    },
  });

  usePlanBuilderHotkeys({
    enabled: nothingInTheWay([
      isLoading,
      initialLoadFailed,
      songPickerOpen,
      removingItemId !== null,
      drag.activeItemId !== null,
    ]),
    items,
    selectedItemId: selectedItem?.id ?? null,
    onSelect: selectAndFocus,
    onMove: (itemId, offset) => {
      reorderNow(async () => {
        await controller.moveItem(itemId, offset);
      });
      focusRow(itemId);
    },
    onToggleDetails: (itemId) => {
      openDetails(itemId);
      requestAnimationFrame(() => {
        paneRef.current
          ?.querySelector<HTMLElement>("button, input, textarea, select")
          ?.focus();
      });
    },
    onRemove: setRemovingItemId,
    onAddSong: openSongPicker,
    onAddBasic: (kind) => {
      addBasicItem(kind);
    },
    onEscape: () => {
      if (detailsOpen) {
        closeDetails();
        return;
      }
      select(null);
    },
  });

  const handlers: PlanItemRowHandlers = {
    onOpen: openDetails,
    onRemove: setRemovingItemId,
    onInsert: (kind, afterItemId) => {
      select(afterItemId);
      if (kind === "song") {
        openSongPicker();
        return;
      }
      addBasicItem(kind, { afterItemId });
    },
    ...inlineEditHandlers(saveItem),
  };

  const detailItem = detailItemOf(detailsOpen, selectedItem);
  const serviceDate = planDate ?? currentDate();
  const pane =
    detailItem === null ? null : (
      <PlanItemPane
        key={detailItem.id}
        item={detailItem}
        serviceTypeId={serviceTypeId}
        planId={planId}
        planDate={serviceDate}
        previousSong={songBefore(items, detailItem)}
        transition={insights.transitions.get(detailItem.id) ?? null}
        focusTitle={titleFocusItemId === detailItem.id}
        onSave={(input) => {
          runQuietly(async () => {
            await saveItem(input);
          });
        }}
        onChangeKey={(item, arrangement, key) => {
          handlers.onChangeKey(item, arrangement, key);
        }}
        onRemove={setRemovingItemId}
        onOpenFile={fileDialog.openFor(detailItem.id)}
        onClose={closeDetails}
        inSheet={!isWide}
        className="max-h-full"
      />
    );
  // Like a sheet: pressing outside the card closes it and clears the selection.
  useDismissOnOutsidePress({
    enabled: isWide && pane !== null,
    ref: paneRef,
    ignoreSelector: KEEPS_DETAILS_OPEN,
    onDismiss: () => {
      blurWithin(paneRef.current);
      setDetailsOpen(false);
      select(null);
    },
  });
  const draggedItem =
    items.find((item) => item.id === drag.activeItemId) ?? null;

  if (initialLoadFailed) {
    return (
      <QueryDataBoundary query={planItemsQuery} title="Couldn't load the plan">
        {null}
      </QueryDataBoundary>
    );
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      modifiers={verticalOnly}
      sensors={drag.sensors}
      {...drag.dragHandlers}
    >
      <AddSongPalette
        open={songPickerOpen}
        onOpenChange={(open) => {
          controller.setSongPickerOpen(open);
        }}
        serviceTypeId={serviceTypeId}
        planId={planId}
        planDate={planDate}
        {...paletteContextOf(items, selectedItem)}
        pendingSongId={controller.pendingSongId}
        onChooseSong={chooseSong}
      />
      <RemoveItemDialog
        item={items.find((item) => item.id === removingItemId) ?? null}
        onCancel={() => {
          setRemovingItemId(null);
        }}
        onConfirm={handleConfirmRemove}
      />
      <PlanFiles
        items={items}
        serviceTypeId={serviceTypeId}
        planId={planId}
        dialog={fileDialog}
      />
      {isWide ? null : (
        <DetailsSheet open={pane !== null} onOpenChange={setDetailsOpen}>
          {pane}
        </DetailsSheet>
      )}
      <div className="relative flex h-full min-h-0 gap-6">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <PageScrollArea>
            <QueryDataBoundary
              query={planItemsQuery}
              title="Couldn't refresh the plan"
            >
              <PlanRunSheet
                isLoading={isLoading}
                revealClassName={revealClassName}
                items={items}
                runSheet={runSheet}
                transitions={insights.transitions}
                recentPlays={insights.recentPlays}
                selectedItemId={selectedItem?.id ?? null}
                activeItemId={drag.activeItemId}
                pendingItemId={controller.pendingItemId}
                serviceTypeId={serviceTypeId}
                handlers={handlers}
                getItemIntentProps={controller.getItemIntentProps}
                onAddSong={openSongPicker}
                onAddBasic={addBasicItem}
              />
            </QueryDataBoundary>
          </PageScrollArea>
          <PlanTabToolbar
            isCreatingBasicItem={controller.isCreatingBasicItem}
            disabled={isLoading}
            onAddSong={openSongPicker}
            onAddHeader={() => {
              addBasicItem("header");
            }}
            onAddItem={() => {
              addBasicItem("item");
            }}
          />
        </div>
        {isWide ? <DetailsAside ref={paneRef} pane={pane} /> : null}
      </div>
      <PlanBuilderDragPreview
        item={draggedItem}
        entry={draggedItem ? runSheet.get(draggedItem.id) : undefined}
        insights={insights}
        serviceTypeId={serviceTypeId}
        handlers={handlers}
      />
    </DndContext>
  );
};
