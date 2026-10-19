/**
 * Zoom for the PDF reader: the +/- steps, two-finger pinch, and double tap all land on one
 * zoom, so the percentage on the control always matches the page.
 */

export const MIN_PDF_ZOOM = 0.25;
export const MAX_PDF_ZOOM = 2;
const ZOOM_STEP = 0.25;
/** The zoom a double tap on a fitted page goes to. */
const DOUBLE_TAP_ZOOM = 2;
/** iOS counts taps up to 300ms apart, within a finger's width, as a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 24;
/** A press held longer than this, or moved further than this, is not a tap. */
const TAP_MS = 250;
const TAP_SLOP_PX = 10;

export const clampZoom = (zoom: number): number =>
  Math.min(MAX_PDF_ZOOM, Math.max(MIN_PDF_ZOOM, zoom));

/** The next quarter step from `zoom`, so a pinched 137% steps to 150% or 125%. */
export const stepZoom = (zoom: number, direction: "in" | "out"): number => {
  const steps = zoom / ZOOM_STEP;
  // A hair of tolerance keeps 100% from reading as a step below itself after float math.
  const next =
    direction === "in"
      ? Math.floor(steps + 1e-6) + 1
      : Math.ceil(steps - 1e-6) - 1;
  return clampZoom(next * ZOOM_STEP);
};

/** The zoom for fingers `distance` apart, in a pinch that began `start.distance` apart. */
export const pinchZoom = (
  start: { readonly zoom: number; readonly distance: number },
  distance: number
): number =>
  start.distance === 0
    ? start.zoom
    : clampZoom((start.zoom * distance) / start.distance);

/** Fit to the width, or 200% from fit. */
export const doubleTapZoom = (zoom: number): number =>
  zoom === 1 ? DOUBLE_TAP_ZOOM : 1;

export interface Tap {
  readonly time: number;
  readonly x: number;
  readonly y: number;
}

/** Whether a finger that went down at `down` and lifted at `up` tapped. */
export const isTap = (down: Tap, up: Tap): boolean =>
  up.time - down.time <= TAP_MS &&
  Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP_PX;

export const isDoubleTap = (previous: Tap | null, next: Tap): boolean =>
  previous !== null &&
  next.time - previous.time <= DOUBLE_TAP_MS &&
  Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_SLOP_PX;

/**
 * Where along the page, from 0 to 1, a point falls. One axis, in screen pixels: `start` is
 * the page's edge and `size` its length.
 */
export const pageFraction = ({
  start,
  size,
  focal,
}: {
  start: number;
  size: number;
  focal: number;
}): number => (size === 0 ? 0 : (focal - start) / size);

/**
 * How far to scroll so the same `fraction` of the resized page sits under `focal` again. The
 * fingers' point stays put as the page grows, and a pinch that also moves pans with them.
 */
export const anchoredScrollDelta = ({
  start,
  size,
  fraction,
  focal,
}: {
  start: number;
  size: number;
  fraction: number;
  focal: number;
}): number => start + fraction * size - focal;
