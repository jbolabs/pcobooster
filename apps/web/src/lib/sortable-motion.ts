import { defaultDropAnimation } from "@dnd-kit/core";
import type { DropAnimation, Modifier } from "@dnd-kit/core";
import type { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** How sortable rows ease aside and how a dropped row settles: quick, no overshoot. */
const SORTABLE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const SORTABLE_DURATION_MS = 180;

/** Pass to `useSortable` so rows make room on the same curve the drop settles on. */
export const sortableTransition = {
  duration: SORTABLE_DURATION_MS,
  easing: SORTABLE_EASING,
};

/** The dragged overlay settles into its new slot on the rows' curve. */
export const sortableDropAnimation: DropAnimation = {
  ...defaultDropAnimation,
  duration: SORTABLE_DURATION_MS,
  easing: SORTABLE_EASING,
};

/** Keeps a dragged row in its column, for lists that only reorder up and down. */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

type SortableState = ReturnType<typeof useSortable>;

/**
 * Values for a `sortable-plan-item` node's `--sortable-transform` and
 * `--sortable-transition`. dnd-kit clears `transition` on the frame rows settle into
 * their new order; it stays cleared, or the rows replay the move from their old places.
 */
export const sortableMotion = ({
  transform,
  transition,
}: Pick<SortableState, "transform" | "transition">) => ({
  transform: CSS.Translate.toString(transform) ?? "none",
  transition: transition ?? "none",
});
