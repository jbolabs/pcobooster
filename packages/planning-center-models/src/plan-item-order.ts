import { planItemLength } from "@pcobooster/planning-center-models/plan-item-draft";
import type {
  PlanItem,
  PlanItemArrangement,
  PlanItemKey,
  PlanItemServicePosition,
  SongCatalogEntry,
} from "@pcobooster/planning-center-models/types";

const isPlanItemServicePosition = (
  value: string
): value is PlanItemServicePosition =>
  value === "pre" || value === "during" || value === "post";

export const appendPlanItem = (items: PlanItem[], item: PlanItem): PlanItem[] =>
  [...items, item].toSorted((a, b) => a.sequence - b.sequence);

export const nextPlanItemSequence = (items: PlanItem[]): number => {
  let maxSequence = 0;
  for (const item of items) {
    maxSequence = Math.max(maxSequence, item.sequence);
  }
  return maxSequence + 1;
};

export const createOptimisticBasicPlanItem = (
  id: string,
  kind: "header" | "item",
  sequence: number
): PlanItem => ({
  id,
  title: kind === "header" ? "New Header" : "New Item",
  itemType: kind,
  sequence,
  servicePosition: "during",
  length: null,
  description: "",
  htmlDetails: "",
  customArrangementSequence: [],
  song: null,
  arrangement: null,
  key: null,
  layout: null,
});

export const createOptimisticSongPlanItem = (
  id: string,
  song: SongCatalogEntry,
  sequence: number
): PlanItem => ({
  id,
  title: song.title,
  itemType: "song",
  sequence,
  servicePosition: "during",
  length: null,
  description: "",
  htmlDetails: "",
  customArrangementSequence: [],
  song: {
    id: song.id,
    title: song.title,
    author: song.author,
    themes: song.themes,
    lastScheduledAt: song.lastScheduledAt,
  },
  arrangement: null,
  key: null,
  layout: null,
});

export const replacePlanItem = (
  items: PlanItem[],
  updatedItem: PlanItem
): PlanItem[] =>
  items.map((item) => (item.id === updatedItem.id ? updatedItem : item));

export const replacePlanItemById = (
  items: PlanItem[],
  itemId: string,
  updatedItem: PlanItem
): PlanItem[] => items.map((item) => (item.id === itemId ? updatedItem : item));

const draftItemLength = (
  length: number | null,
  itemType: string
): number | null => {
  const normalized = planItemLength(length, itemType);
  return normalized === 0 ? null : (normalized ?? null);
};

export const applyPlanItemDraft = (
  item: PlanItem,
  draft: {
    title: string;
    servicePosition: string;
    description: string;
    arrangementId?: string;
    keyId?: string;
  },
  length: number | null,
  arrangement: PlanItemArrangement | null,
  key: PlanItemKey | null
): PlanItem => ({
  ...item,
  title: item.song ? item.title : draft.title,
  servicePosition: isPlanItemServicePosition(draft.servicePosition)
    ? draft.servicePosition
    : item.servicePosition,
  length: draftItemLength(length, item.itemType),
  description: draft.description,
  arrangement,
  key,
});

export const planItemDraftChangesItem = (
  item: PlanItem,
  draft: {
    title: string;
    servicePosition: string;
    description: string;
    arrangementId?: string;
    keyId?: string;
  },
  length: number | null
): boolean => {
  const normalizedLength = draftItemLength(length, item.itemType);
  const normalizedArrangementId = draft.arrangementId ?? null;
  const normalizedKeyId = draft.keyId ?? null;

  if (!item.song && draft.title !== item.title) {
    return true;
  }
  if (draft.servicePosition !== item.servicePosition) {
    return true;
  }
  if (normalizedLength !== item.length) {
    return true;
  }
  if (draft.description !== item.description) {
    return true;
  }
  if (item.song && normalizedArrangementId !== (item.arrangement?.id ?? null)) {
    return true;
  }
  if (item.song && normalizedKeyId !== (item.key?.id ?? null)) {
    return true;
  }

  return false;
};

export const removePlanItem = (
  items: PlanItem[],
  itemId: string
): PlanItem[] => {
  const remainingItems: PlanItem[] = [];
  for (const item of items) {
    if (item.id !== itemId) {
      remainingItems.push({ ...item, sequence: remainingItems.length + 1 });
    }
  }
  return remainingItems;
};

export const movePlanItem = (
  items: PlanItem[],
  fromIndex: number,
  toIndex: number
): PlanItem[] => {
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (movedItem === undefined) {
    return items;
  }

  nextItems.splice(toIndex, 0, movedItem);
  return nextItems.map((item, index) => ({
    ...item,
    sequence: index + 1,
  }));
};

export const reorderPlanItems = (
  items: PlanItem[],
  draggedItemId: string,
  targetItemId: string
): PlanItem[] => {
  if (draggedItemId === targetItemId) {
    return items;
  }

  const fromIndex = items.findIndex((item) => item.id === draggedItemId);
  const toIndex = items.findIndex((item) => item.id === targetItemId);
  if (fromIndex === -1 || toIndex === -1) {
    return items;
  }

  return movePlanItem(items, fromIndex, toIndex);
};

/**
 * Where a new item goes in the plan: after `afterItemId`, at the top when it is null,
 * or at the end when there is no insertion point.
 */
export interface PlanInsertion {
  afterItemId: string | null;
}

const renumber = (items: PlanItem[]): PlanItem[] =>
  items.map((item, index) => ({ ...item, sequence: index + 1 }));

export const insertPlanItem = (
  items: PlanItem[],
  item: PlanItem,
  insertion?: PlanInsertion
): PlanItem[] => {
  if (insertion === undefined) {
    return renumber([...items, item]);
  }
  const afterIndex =
    insertion.afterItemId === null
      ? -1
      : items.findIndex((candidate) => candidate.id === insertion.afterItemId);
  const index =
    insertion.afterItemId !== null && afterIndex === -1
      ? items.length
      : afterIndex + 1;
  return renumber([...items.slice(0, index), item, ...items.slice(index)]);
};

/** Moves an item one place up or down; items already at that end stay put. */
export const shiftPlanItem = (
  items: PlanItem[],
  itemId: string,
  offset: -1 | 1
): PlanItem[] => {
  const fromIndex = items.findIndex((item) => item.id === itemId);
  const toIndex = fromIndex + offset;
  if (fromIndex === -1 || toIndex < 0 || toIndex >= items.length) {
    return items;
  }
  return movePlanItem(items, fromIndex, toIndex);
};

export const planItemsHaveSameOrder = (
  currentItems: PlanItem[],
  nextItems: PlanItem[]
): boolean => {
  if (currentItems.length !== nextItems.length) {
    return false;
  }

  return currentItems.every((item, index) => item.id === nextItems[index]?.id);
};
