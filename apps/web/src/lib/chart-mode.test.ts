import { describe, expect, it } from "vitest";

import { latchChartMode } from "@/lib/chart-mode";

const empty = { id: "a", chordChart: "  " };
const filled = { id: "a", chordChart: "VERSE 1\n[G]Amazing grace" };

describe(latchChartMode, () => {
  it("opens an empty chart to edit and keeps editing once the first save fills it", () => {
    const opened = latchChartMode(null, empty, "editor");
    expect(opened).toStrictEqual({
      arrangementId: "a",
      mode: "edit",
      chosen: false,
    });
    expect(latchChartMode(opened, filled, "editor")).toBe(opened);
  });

  it("opens a written chart, and any chart for a viewer, to read", () => {
    expect(latchChartMode(null, filled, "editor")?.mode).toBe("read");
    expect(latchChartMode(null, empty, "viewer")?.mode).toBe("read");
  });

  it("waits for permissions before deciding", () => {
    expect(latchChartMode(null, empty, "pending")).toBeNull();
    expect(latchChartMode(null, empty, "unavailable")).toBeNull();
  });

  it("keeps editing on another arrangement, and reads one opened from reading", () => {
    const editing = {
      arrangementId: "a",
      mode: "edit",
      chosen: true,
    } as const;
    const reading = { ...editing, mode: "read" } as const;
    const other = { id: "b", chordChart: "CHORUS" };
    expect(latchChartMode(editing, other, "editor")).toStrictEqual({
      arrangementId: "b",
      mode: "edit",
      chosen: false,
    });
    expect(latchChartMode(reading, other, "editor")?.mode).toBe("read");
  });
});
