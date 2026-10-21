import { describe, expect, it } from "vitest";

import {
  edgeAtPoint,
  placeEdge,
  scrubBy,
  scrubLabel,
  scrubRate,
  timeAtPoint,
} from "@/lib/scrub";

/** On a 300px bar for 240s, A at 60s sits at 75px and B at 90s at 112.5px. */
const target = (x: number) =>
  edgeAtPoint({
    x,
    bounds: { left: 0, width: 300 },
    loop: { start: 60, end: 90 },
    duration: 240,
    reach: 22,
  });

describe("timeline scrubbing", () => {
  it("slows the playhead as the finger slides away from the timeline, either way", () => {
    expect([0, 30, -60, 120, -200].map((y) => scrubRate(y))).toStrictEqual([
      1, 1, 0.5, 0.25, 0.1,
    ]);
  });

  it("moves a 4-minute song by the share of a 300px bar the finger crosses", () => {
    // 75px of 300px is a quarter of 240s: 60s at full speed, 6s at a tenth.
    expect([
      scrubBy({ time: 30, dx: 75, width: 300, duration: 240, rate: 1 }),
      scrubBy({ time: 30, dx: 75, width: 300, duration: 240, rate: 0.1 }),
      scrubBy({ time: 30, dx: -150, width: 300, duration: 240, rate: 1 }),
      scrubBy({ time: 230, dx: 150, width: 300, duration: 240, rate: 1 }),
    ]).toStrictEqual([90, 36, 0, 240]);
  });

  it("reads the time under a tap, pinned to the ends of the bar", () => {
    const bounds = { left: 20, width: 200 };
    expect([
      timeAtPoint(70, bounds, 180),
      timeAtPoint(0, bounds, 180),
      timeAtPoint(400, bounds, 180),
    ]).toStrictEqual([45, 0, 180]);
  });

  it("grabs the nearer loop handle within reach, and the playhead elsewhere", () => {
    expect([
      target(60),
      target(90),
      target(100),
      target(130),
      target(200),
    ]).toStrictEqual(["start", "start", "end", "end", null]);
  });

  it("keeps a dragged handle inside the recording and a tenth of a second from the other", () => {
    const loop = { start: 60, end: 90 };
    expect([
      placeEdge(loop, "start", 45, 240),
      placeEdge(loop, "start", 120, 240),
      placeEdge(loop, "end", 10, 240),
      placeEdge(loop, "end", 300, 240),
    ]).toStrictEqual([
      { start: 45, end: 90 },
      { start: 89.9, end: 90 },
      { start: 60, end: 60.1 },
      { start: 60, end: 240 },
    ]);
  });

  it("labels a drag with its handle and rate, and says nothing for a plain mouse drag", () => {
    expect([
      scrubLabel({ time: 1, rate: 0.25, edge: null, touch: true }),
      scrubLabel({ time: 1, rate: 1, edge: "end", touch: true }),
      scrubLabel({ time: 1, rate: 0.5, edge: "start", touch: false }),
      scrubLabel({ time: 1, rate: 1, edge: null, touch: false }),
    ]).toStrictEqual(["0.25×", "Loop end · 1×", "Loop start · 0.5×", null]);
  });
});
