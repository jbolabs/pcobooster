import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { RunSheetEntry } from "@pcobooster/planning-center-models/plan-item-draft";
import { formatDuration } from "@pcobooster/planning-center-models/plan-overview";
import type { KeyTransition } from "@pcobooster/planning-center-models/plan-set-insights";
import type {
  ArrangementOption,
  KeyOption,
  PlanItem,
} from "@pcobooster/planning-center-models/types";
import {
  AlignLeft,
  FileMusic,
  History,
  Music2,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import { useMemo, useRef } from "react";
import type { CSSProperties } from "react";

import {
  ItemLengthEditor,
  SongKeyPicker,
} from "@/components/schedule/plan-item-inline-editors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DragHandle } from "@/components/ui/drag-handle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverLabel } from "@/components/ui/hover-card";
import { Item } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { IntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { sortableMotion, sortableTransition } from "@/lib/sortable-motion";
import { cn } from "@/lib/utils";

export type PlanInsertKind = "song" | "header" | "item";

const planItemSkeletonRows = [
  { key: "a", header: true, title: "9rem" },
  { key: "b", header: false, title: "11rem" },
  { key: "c", header: false, title: "8rem" },
  { key: "d", header: false, title: "10rem" },
  { key: "e", header: true, title: "7rem" },
  { key: "f", header: false, title: "9rem" },
  { key: "g", header: false, title: "6rem" },
];

export const PlanItemListSkeleton = () => (
  <div className="flex w-full flex-col pb-4 contain-inline-size">
    {planItemSkeletonRows.map((row) =>
      row.header ? (
        <div
          key={row.key}
          className="bg-muted/50 mt-4 flex h-9 items-center rounded-lg pr-3 pl-8 first:mt-0"
        >
          <Skeleton variant="text" className="h-3" width={row.title} />
        </div>
      ) : (
        <div key={row.key} className="flex min-h-13 items-center gap-3 pl-8">
          <Skeleton variant="text" className="h-3 w-8" />
          <Skeleton variant="text" className="ml-4 h-3.5" width={row.title} />
        </div>
      )
    )}
  </div>
);

/**
 * Row controls stay hidden until the row is hovered, focused, or selected, except on
 * touch screens (no hover) and on the row being dragged.
 */
const revealWithRow = (isDragged: boolean) =>
  !isDragged &&
  "pointer-fine:opacity-0 pointer-fine:group-focus-within/plan-item:opacity-100 pointer-fine:group-hover/plan-item:opacity-100 pointer-fine:group-data-[selected=true]/plan-item:opacity-100";

/** Where an item off the service clock runs; nothing for items during it. */
const OFF_CLOCK_LABELS = {
  pre: "before",
  post: "after",
  during: "",
} as const;

const RecentPlayHint = ({ days }: { days: number }) => (
  <HoverLabel
    label={`Played ${days === 1 ? "the day" : `${days} days`} before this plan`}
    render={
      <span className="text-status-scheduled pointer-events-auto inline-flex shrink-0 items-center gap-1 text-xs" />
    }
  >
    <History className="size-3" aria-hidden />
    {days < 7 ? `${days}d ago` : `${Math.round(days / 7)}w ago`}
  </HoverLabel>
);

const HeaderRowContent = ({
  title,
  sectionLength,
}: {
  title: string;
  sectionLength: number | null;
}) => {
  const lengthLabel =
    sectionLength === null ? null : formatDuration(sectionLength);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="min-w-0 flex-1 text-xs font-semibold tracking-wide uppercase max-sm:line-clamp-2 sm:truncate">
        {title}
      </span>
      {lengthLabel === null ? null : (
        <span className="text-muted-foreground text-xs tabular-nums">
          {lengthLabel}
        </span>
      )}
    </span>
  );
};

const ItemRowContent = ({
  item,
  title,
  transition,
  recentPlayDays,
  serviceTypeId,
  handlers,
}: {
  item: PlanItem;
  title: string;
  transition: KeyTransition | null;
  recentPlayDays: number | null;
  serviceTypeId: string | null;
  handlers: PlanItemRowHandlers;
}) => (
  <>
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 text-sm font-medium max-sm:line-clamp-2 sm:truncate">
        {title}
      </span>
      {item.itemType === "song" ? (
        <span className="pointer-events-auto">
          <SongKeyPicker
            item={item}
            serviceTypeId={serviceTypeId}
            transition={transition}
            onChange={(arrangement, key) => {
              handlers.onChangeKey(item, arrangement, key);
            }}
            onAddNote={(note) => {
              handlers.onAddNote(item, note);
            }}
          />
        </span>
      ) : null}
      {item.arrangement ? (
        <span className="text-muted-foreground truncate text-xs max-sm:hidden">
          {item.arrangement.name}
        </span>
      ) : null}
      {recentPlayDays === null ? null : (
        <RecentPlayHint days={recentPlayDays} />
      )}
    </span>
    {item.description ? (
      <span className="text-muted-foreground line-clamp-4 text-xs whitespace-pre-line">
        {item.description}
      </span>
    ) : null}
  </>
);

export interface PlanItemRowHandlers {
  /** Select the row and show its details. */
  onOpen: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onInsert: (kind: PlanInsertKind, afterItemId: string) => void;
  onChangeKey: (
    item: PlanItem,
    arrangement: ArrangementOption,
    key: KeyOption
  ) => void;
  onChangeLength: (item: PlanItem, length: number | null) => void;
  /** Adds a line to the item's notes, such as a key change idea. */
  onAddNote: (item: PlanItem, note: string) => void;
  onInvalidLength: (message: string) => void;
}

interface PlanItemRowProps {
  item: PlanItem;
  entry: RunSheetEntry | undefined;
  transition: KeyTransition | null;
  recentPlayDays: number | null;
  selected: boolean;
  isBusy: boolean;
  isDragged: boolean;
  serviceTypeId: string | null;
  handlers: PlanItemRowHandlers;
  dragAttributes?: ReturnType<typeof useSortable>["attributes"];
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  intentProps?: IntentPrefetchProps;
}

const rowSurfaceClassName = (
  isHeader: boolean,
  highlighted: boolean
): string => {
  if (highlighted) {
    return "bg-muted";
  }
  return isHeader ? "bg-muted/50 hover:bg-muted" : "hover:bg-muted/60";
};

/**
 * One run sheet row, laid out like Planning Center's order (grip, length, title and
 * notes) with the key, length, and start time editable in place. The whole row is one
 * button that opens the item; its controls sit above that button.
 */
export const PlanItemRow = ({
  item,
  entry,
  transition,
  recentPlayDays,
  selected,
  isBusy,
  isDragged,
  serviceTypeId,
  handlers,
  dragAttributes,
  dragListeners,
  intentProps,
}: PlanItemRowProps) => {
  const isHeader = item.itemType === "header";
  const itemActionLabel = item.title || "plan item";
  const displayTitle = item.title || "Untitled item";
  const startLabel = OFF_CLOCK_LABELS[item.servicePosition];

  return (
    <div
      aria-busy={isBusy}
      data-plan-item-id={item.id}
      data-selected={selected}
      className={cn(
        "group/plan-item stale-while-busy has-[[data-slot=item]:focus-visible]:ring-ring/50 relative flex items-stretch rounded-lg has-[[data-slot=item]:focus-visible]:ring-2",
        isHeader ? "min-h-9" : "min-h-13",
        rowSurfaceClassName(isHeader, isDragged || selected)
      )}
    >
      <Item
        variant="plain"
        size="xs"
        className="absolute inset-0"
        render={
          <button
            type="button"
            aria-label={`Open ${displayTitle}`}
            aria-current={selected ? "true" : undefined}
          />
        }
        {...intentProps}
        onClick={() => {
          handlers.onOpen(item.id);
        }}
      />
      <div className="relative flex shrink-0">
        <DragHandle
          {...dragAttributes}
          {...dragListeners}
          size="sm"
          disabled={isBusy}
          aria-label={`Reorder ${itemActionLabel}`}
        />
      </div>
      {isHeader ? null : (
        <div className="relative flex w-16 shrink-0 flex-col items-start justify-center py-1.5">
          <ItemLengthEditor
            item={item}
            onChange={(length) => {
              handlers.onChangeLength(item, length);
            }}
            onInvalid={(message) => {
              handlers.onInvalidLength(message);
            }}
          />
          {startLabel === "" ? null : (
            <span className="text-muted-foreground pointer-events-none pl-2.5 text-xs leading-tight tabular-nums">
              {startLabel}
            </span>
          )}
        </div>
      )}
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col justify-center gap-1 py-2 pr-2">
        {isHeader ? (
          <HeaderRowContent
            title={displayTitle}
            sectionLength={entry?.sectionLength ?? null}
          />
        ) : (
          <ItemRowContent
            item={item}
            title={displayTitle}
            transition={transition}
            recentPlayDays={recentPlayDays}
            serviceTypeId={serviceTypeId}
            handlers={handlers}
          />
        )}
      </div>
      <div
        className={cn(
          "relative flex items-center pr-1.5 max-sm:hidden",
          revealWithRow(isDragged)
        )}
      >
        <Button
          type="button"
          variant="ghost-destructive"
          size="icon-sm"
          onClick={() => {
            handlers.onRemove(item.id);
          }}
          disabled={isBusy}
          aria-label={`Remove ${itemActionLabel}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
};

/** A line under the row that opens an add menu, for putting something exactly here. */
const InsertAfter = ({
  itemTitle,
  onInsert,
}: {
  itemTitle: string;
  onInsert: (kind: PlanInsertKind) => void;
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Where the pointer pressed the strip, so the menu opens there; the plus otherwise.
  const pressedX = useRef<number | null>(null);
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () => {
        const strip = triggerRef.current?.getBoundingClientRect();
        const x = pressedX.current ?? strip?.left ?? 0;
        return new DOMRect(x, strip?.top ?? 0, 0, strip?.height ?? 0);
      },
    }),
    []
  );
  return (
    <div className="absolute inset-x-0 -bottom-2 z-10 flex h-4 opacity-0 hover:opacity-100 has-focus-visible:opacity-100 has-data-popup-open:opacity-100 max-sm:hidden pointer-coarse:hidden">
      <DropdownMenu>
        {/* The whole strip opens the menu; the plus only marks where it is. */}
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label={`Add after ${itemTitle}`}
          className="group/insert flex flex-1 cursor-pointer items-center"
          onPointerDown={(event) => {
            pressedX.current = event.clientX;
          }}
          onKeyDown={() => {
            pressedX.current = null;
          }}
        >
          <span
            aria-hidden
            className="border-border bg-background text-muted-foreground group-hover/insert:text-foreground flex size-5 shrink-0 items-center justify-center rounded-full border"
          >
            <Plus className="size-3" />
          </span>
          <span
            aria-hidden
            className="bg-primary/40 group-hover/insert:bg-primary/70 ml-1 h-0.5 flex-1 rounded-full"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" anchor={anchor}>
          <DropdownMenuItem
            onClick={() => {
              onInsert("song");
            }}
          >
            <Music2 />
            Song
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              onInsert("header");
            }}
          >
            <Type />
            Header
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              onInsert("item");
            }}
          >
            <AlignLeft />
            Item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

interface SortablePlanItemProps extends Omit<
  PlanItemRowProps,
  "dragAttributes" | "dragListeners" | "isDragged"
> {
  isDragging: boolean;
}

const SortablePlanItem = ({
  item,
  isDragging,
  ...rowProps
}: SortablePlanItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: item.id, transition: sortableTransition });

  const motion = sortableMotion({ transform, transition });
  const style: CSSProperties & {
    "--sortable-transform": string;
    "--sortable-transition": string;
  } = {
    "--sortable-transform": motion.transform,
    "--sortable-transition": motion.transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "sortable-plan-item relative",
        item.itemType === "header" ? "pt-3 first:pt-0" : "plan-item-divider",
        isSortableDragging && "z-20 opacity-0"
      )}
    >
      <PlanItemRow
        item={item}
        {...rowProps}
        isDragged={isDragging || isSortableDragging}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
      <InsertAfter
        itemTitle={item.title || "this item"}
        onInsert={(kind) => {
          rowProps.handlers.onInsert(kind, item.id);
        }}
      />
    </div>
  );
};

interface PlanItemListProps {
  items: PlanItem[];
  runSheet: ReadonlyMap<string, RunSheetEntry>;
  transitions: ReadonlyMap<string, KeyTransition>;
  recentPlays: ReadonlyMap<string, number>;
  selectedItemId: string | null;
  activeItemId: string | null;
  pendingItemId: string | null;
  serviceTypeId: string | null;
  handlers: PlanItemRowHandlers;
  getItemIntentProps?: (itemId: string) => IntentPrefetchProps;
}

/** The run sheet's rows. The drag context lives in the builder. */
export const PlanItemList = ({
  items,
  runSheet,
  transitions,
  recentPlays,
  selectedItemId,
  activeItemId,
  pendingItemId,
  serviceTypeId,
  handlers,
  getItemIntentProps,
}: PlanItemListProps) => (
  <SortableContext
    items={items.map((item) => item.id)}
    strategy={verticalListSortingStrategy}
  >
    {/* Sized by the page, not by long titles, so truncation holds. */}
    <div className="pb-safe-4 flex w-full flex-col contain-inline-size md:pb-4">
      {items.map((item) => (
        <SortablePlanItem
          key={item.id}
          item={item}
          entry={runSheet.get(item.id)}
          transition={transitions.get(item.id) ?? null}
          recentPlayDays={recentPlays.get(item.id) ?? null}
          selected={selectedItemId === item.id}
          isBusy={pendingItemId === item.id}
          isDragging={activeItemId === item.id}
          serviceTypeId={serviceTypeId}
          handlers={handlers}
          intentProps={getItemIntentProps?.(item.id)}
        />
      ))}
    </div>
  </SortableContext>
);

export const PlanItemListEmpty = ({
  onAddSong,
  onAddHeader,
  onAddItem,
}: {
  onAddSong: () => void;
  onAddHeader: () => void;
  onAddItem: () => void;
}) => (
  <div className="py-1">
    <Card className="text-center">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
        <FileMusic className="text-muted-foreground/70 size-5" />
        <div>
          <p className="text-sm font-medium">This plan has no structure yet</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Pick a song from the library, or start with a header or item.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" onClick={onAddSong}>
            <Music2 className="size-4" />
            Add song
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddHeader}
          >
            Add header
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onAddItem}>
            Add item
          </Button>
        </div>
      </div>
    </Card>
  </div>
);
