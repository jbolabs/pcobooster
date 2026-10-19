import { describe, expect, it } from "vitest";

import {
  anchoredScrollDelta,
  doubleTapZoom,
  isDoubleTap,
  pageFraction,
  pinchZoom,
  stepZoom,
} from "@/lib/pdf-zoom";

describe(pinchZoom, () => {
  it("scales the zoom the pinch started at by how far the fingers spread", () => {
    // Fingers 100px apart at 100% move to 150px apart: 150%.
    expect(pinchZoom({ zoom: 1, distance: 100 }, 150)).toBe(1.5);
    // Pinching in from 200px to 100px at 150%: 75%.
    expect(pinchZoom({ zoom: 1.5, distance: 200 }, 100)).toBe(0.75);
  });

  it("stops at the reader's limits", () => {
    expect(pinchZoom({ zoom: 1.5, distance: 100 }, 400)).toBe(2);
    expect(pinchZoom({ zoom: 0.5, distance: 400 }, 100)).toBe(0.25);
  });

  it("holds the zoom when the fingers start on one spot", () => {
    expect(pinchZoom({ zoom: 1.25, distance: 0 }, 80)).toBe(1.25);
  });
});

describe(stepZoom, () => {
  it("moves by quarter steps from the grid", () => {
    expect(stepZoom(1, "in")).toBe(1.25);
    expect(stepZoom(1, "out")).toBe(0.75);
  });

  it("snaps a pinched zoom to the next step in the pressed direction", () => {
    expect(stepZoom(1.37, "in")).toBe(1.5);
    expect(stepZoom(1.37, "out")).toBe(1.25);
  });

  it("stops at the limits", () => {
    expect(stepZoom(2, "in")).toBe(2);
    expect(stepZoom(0.25, "out")).toBe(0.25);
  });
});

describe(anchoredScrollDelta, () => {
  it("keeps the point under the fingers in place as the page grows", () => {
    // A 300px page from x=40; the fingers at x=190 are halfway across it.
    const fraction = pageFraction({ start: 40, size: 300, focal: 190 });
    expect(fraction).toBe(0.5);
    // At 600px the page starts at x=0 (no longer centered): its middle is at 300, 110px
    // right of the fingers, so the reader scrolls 110px right.
    expect(
      anchoredScrollDelta({ start: 0, size: 600, fraction, focal: 190 })
    ).toBe(110);
  });

  it("follows fingers that pan while they pinch", () => {
    // Same zoom, fingers moved 30px left: the reader scrolls 30px on, so the page moves with them.
    expect(
      anchoredScrollDelta({ start: 40, size: 300, fraction: 0.5, focal: 160 })
    ).toBe(30);
  });
});

describe("double tap", () => {
  it("zooms a fitted page in to 200%, and anything else back to fit", () => {
    expect(doubleTapZoom(1)).toBe(2);
    expect(doubleTapZoom(0.5)).toBe(1);
    expect(doubleTapZoom(1.5)).toBe(1);
  });

  it("counts a second tap close in time and place", () => {
    const first = { time: 1000, x: 100, y: 200 };
    expect(isDoubleTap(first, { time: 1250, x: 110, y: 210 })).toBeTruthy();
    expect(isDoubleTap(first, { time: 1400, x: 100, y: 200 })).toBeFalsy();
    expect(isDoubleTap(first, { time: 1100, x: 160, y: 200 })).toBeFalsy();
    expect(isDoubleTap(null, { time: 1100, x: 100, y: 200 })).toBeFalsy();
  });
});
