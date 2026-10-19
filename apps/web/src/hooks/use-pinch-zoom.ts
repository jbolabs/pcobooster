import { useEffect, useEffectEvent } from "react";
import type { RefObject } from "react";

import {
  anchoredScrollDelta,
  doubleTapZoom,
  isDoubleTap,
  isTap,
  pageFraction,
  pinchZoom,
} from "@/lib/pdf-zoom";
import type { Tap } from "@/lib/pdf-zoom";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Pinch {
  readonly zoom: number;
  readonly distance: number;
  /** Where the fingers' midpoint fell on the page when the pinch began, from 0 to 1. */
  readonly fraction: Point;
}

const pointOf = (touch: Touch): Point => ({
  x: touch.clientX,
  y: touch.clientY,
});

const fingers = (touches: TouchList): readonly [Point, Point] | null => {
  const [first, second] = [touches.item(0), touches.item(1)];
  return first === null || second === null
    ? null
    : [pointOf(first), pointOf(second)];
};

/**
 * Pinch and double tap to zoom a page inside a scroller, about the fingers. One finger
 * scrolls natively, so a zoomed page pans like any scrolled content; the scroller should
 * declare `touch-pan-x touch-pan-y`, leaving the browser no pinch or double-tap zoom of its
 * own. While a pinch moves, `resize` sizes the page directly and `onPreview` reports the
 * zoom; the gesture ends with `onCommit`, where the reader draws the page sharp again.
 */
export const usePinchZoom = ({
  scroller,
  page,
  zoom,
  resize,
  onPreview,
  onCommit,
}: {
  scroller: RefObject<HTMLElement | null>;
  page: RefObject<HTMLElement | null>;
  /** The zoom the page shows now. */
  zoom: number;
  resize: (zoom: number) => void;
  onPreview: (zoom: number) => void;
  onCommit: (zoom: number) => void;
}) => {
  const currentZoom = useEffectEvent(() => zoom);
  const zoomAbout = useEffectEvent(
    (next: number, focal: Point, fraction: Point) => {
      const scrollerElement = scroller.current;
      const pageElement = page.current;
      if (scrollerElement === null || pageElement === null) {
        return;
      }
      resize(next);
      const box = pageElement.getBoundingClientRect();
      scrollerElement.scrollBy({
        left: anchoredScrollDelta({
          start: box.left,
          size: box.width,
          fraction: fraction.x,
          focal: focal.x,
        }),
        top: anchoredScrollDelta({
          start: box.top,
          size: box.height,
          fraction: fraction.y,
          focal: focal.y,
        }),
        behavior: "instant",
      });
      onPreview(next);
    }
  );
  const commit = useEffectEvent((next: number) => {
    onCommit(next);
  });

  useEffect((): (() => void) | undefined => {
    const element = scroller.current;
    if (element === null) {
      return undefined;
    }
    let pinch: Pinch | null = null;
    let last = 0;
    let down: Tap | null = null;
    let lastTap: Tap | null = null;

    const fractionAt = (point: Point): Point => {
      const box = page.current?.getBoundingClientRect();
      return box === undefined
        ? { x: 0, y: 0 }
        : {
            x: pageFraction({
              start: box.left,
              size: box.width,
              focal: point.x,
            }),
            y: pageFraction({
              start: box.top,
              size: box.height,
              focal: point.y,
            }),
          };
    };

    const onStart = (event: TouchEvent) => {
      const pair = fingers(event.touches);
      if (pair === null) {
        const touch = event.touches.item(0);
        down =
          event.touches.length === 1 && touch !== null
            ? { time: event.timeStamp, ...pointOf(touch) }
            : null;
        return;
      }
      down = null;
      lastTap = null;
      const [a, b] = pair;
      last = currentZoom();
      pinch = {
        zoom: last,
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        fraction: fractionAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      };
    };

    const onMove = (event: TouchEvent) => {
      const touch = event.touches.item(0);
      // A finger that slides is scrolling, not tapping.
      if (
        down !== null &&
        touch !== null &&
        !isTap(down, { time: down.time, ...pointOf(touch) })
      ) {
        down = null;
        lastTap = null;
      }
      const pair = fingers(event.touches);
      if (pinch === null || pair === null) {
        return;
      }
      // Two fingers are the reader's: without this the browser scrolls under the pinch.
      event.preventDefault();
      const [a, b] = pair;
      last = pinchZoom(pinch, Math.hypot(a.x - b.x, a.y - b.y));
      zoomAbout(
        last,
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        pinch.fraction
      );
    };

    const onEnd = (event: TouchEvent) => {
      if (pinch !== null) {
        if (event.touches.length < 2) {
          pinch = null;
          commit(last);
        }
        return;
      }
      const touch = event.changedTouches.item(0);
      if (down === null || touch === null || event.touches.length > 0) {
        return;
      }
      const tap: Tap = { time: event.timeStamp, ...pointOf(touch) };
      const tapped = isTap(down, tap);
      down = null;
      if (!tapped) {
        // A long hold breaks a double tap, like a scroll does.
        lastTap = null;
        return;
      }
      if (!isDoubleTap(lastTap, tap)) {
        lastTap = tap;
        return;
      }
      lastTap = null;
      const next = doubleTapZoom(currentZoom());
      zoomAbout(next, tap, fractionAt(tap));
      commit(next);
    };

    const onCancel = () => {
      down = null;
      lastTap = null;
      if (pinch !== null) {
        pinch = null;
        commit(last);
      }
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onCancel);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onCancel);
    };
  }, [scroller, page]);
};
