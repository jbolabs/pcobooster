import { LOOP_STEP } from "@/lib/practice";
import type { LoopEdge, LoopRegion } from "@/lib/practice";

/**
 * Timeline scrubbing: a drag moves the playhead (or a loop handle) by how far the pointer
 * travels, scaled by how far it has slid away from the timeline. Dragging along the bar
 * covers the whole recording; sliding the finger away first slows it so a passage lands
 * exactly.
 */

/** Scrub rates, each starting this many CSS pixels from the timeline's center line. */
const SCRUB_RATES: readonly { readonly from: number; readonly rate: number }[] =
  [
    { from: 0, rate: 1 },
    { from: 48, rate: 0.5 },
    { from: 104, rate: 0.25 },
    { from: 160, rate: 0.1 },
  ];

/** Seconds of recording per second's worth of timeline the pointer crosses. */
export const scrubRate = (distance: number): number => {
  const away = Math.abs(distance);
  let rate = 1;
  for (const entry of SCRUB_RATES) {
    if (away >= entry.from) {
      ({ rate } = entry);
    }
  }
  return rate;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

interface Bounds {
  readonly left: number;
  readonly width: number;
}

/** The time under a point on the timeline. */
export const timeAtPoint = (
  x: number,
  bounds: Bounds,
  duration: number
): number => {
  if (bounds.width <= 0 || duration <= 0) {
    return 0;
  }
  return clamp((x - bounds.left) / bounds.width, 0, 1) * duration;
};

/** The playhead after the pointer moves `dx` pixels across a `width`-pixel timeline. */
export const scrubBy = ({
  time,
  dx,
  width,
  duration,
  rate,
}: {
  time: number;
  dx: number;
  width: number;
  duration: number;
  rate: number;
}): number => {
  if (width <= 0 || duration <= 0) {
    return clamp(time, 0, Math.max(duration, 0));
  }
  return clamp(time + (dx / width) * duration * rate, 0, duration);
};

/** The loop handle a press lands on: the nearer one within `reach` pixels, or none. */
export const edgeAtPoint = ({
  x,
  bounds,
  loop,
  duration,
  reach,
}: {
  x: number;
  bounds: Bounds;
  loop: LoopRegion;
  duration: number;
  reach: number;
}): LoopEdge | null => {
  if (bounds.width <= 0 || duration <= 0) {
    return null;
  }
  const at = (time: number) => bounds.left + (time / duration) * bounds.width;
  const fromStart = Math.abs(x - at(loop.start));
  const fromEnd = Math.abs(x - at(loop.end));
  if (Math.min(fromStart, fromEnd) > reach) {
    return null;
  }
  return fromStart <= fromEnd ? "start" : "end";
};

/** The loop with one edge moved to `time`, kept inside the recording and a step from the other. */
export const placeEdge = (
  loop: LoopRegion,
  edge: LoopEdge,
  time: number,
  duration: number
): LoopRegion =>
  edge === "start"
    ? { ...loop, start: clamp(time, 0, loop.end - LOOP_STEP) }
    : { ...loop, end: clamp(time, loop.start + LOOP_STEP, duration) };

export interface ScrubPreview {
  /** Where the dragged playhead or loop handle is. */
  readonly time: number;
  readonly rate: number;
  readonly edge: LoopEdge | null;
  readonly touch: boolean;
}

/**
 * What a drag is doing, such as `Loop start · 0.5×`: which handle, and the scrub rate once a
 * finger is on the bar or anything drags slower than the bar.
 */
export const scrubLabel = (preview: ScrubPreview): string | null => {
  const parts: string[] = [];
  if (preview.edge !== null) {
    parts.push(preview.edge === "start" ? "Loop start" : "Loop end");
  }
  if (preview.touch || preview.rate < 1) {
    parts.push(`${String(preview.rate)}×`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
};
