// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { PlaybackTimeline } from "@/components/practice/playback-timeline";

/** A 300px-wide timeline whose center line sits at y = 100. */
const BAR = { left: 0, top: 90, width: 300, height: 20 };

const pointer = (
  target: Element,
  type: string,
  x: number,
  y: number,
  pointerType = "touch"
) => {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType,
      clientX: x,
      clientY: y,
    })
  );
};

const renderTimeline = async (time: number) => {
  const seeks: number[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(PlaybackTimeline, {
        time,
        duration: 240,
        disabled: false,
        loop: null,
        onSeek: (target: number) => {
          seeks.push(target);
        },
        onLoopChange: () => {},
      })
    );
    await Promise.resolve();
  });
  const layer = container.querySelector(".cursor-pointer.touch-none");
  if (!(layer instanceof HTMLElement)) {
    throw new Error("Expected the scrub layer");
  }
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({
      x: BAR.left,
      y: BAR.top,
      width: BAR.width,
      height: BAR.height,
    })
  );
  layer.setPointerCapture = () => {};
  const cleanup = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  return { container, layer, seeks, cleanup };
};

describe("timeline scrubbing", () => {
  it("lets a finger grab the playhead where it is and slows it as the finger slides away", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { container, layer, seeks, cleanup } = await renderTimeline(30);
    try {
      await act(async () => {
        // Touching down at 2:00 on the bar does not jump there.
        pointer(layer, "pointerdown", 150, 100);
        // 75px along the bar is a quarter of 4:00: one minute later.
        pointer(layer, "pointermove", 225, 100);
        // Sliding 120px away (quarter speed), 100px more is 20s, not 80s.
        pointer(layer, "pointermove", 225, 220);
        pointer(layer, "pointermove", 325, 220);
        await Promise.resolve();
      });
      const hint = container.textContent;
      await act(async () => {
        pointer(layer, "pointerup", 325, 220);
        await Promise.resolve();
      });
      expect({ final: seeks.at(-1), hint }).toStrictEqual({
        final: 110,
        hint: "1:500.25×",
      });
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("seeks to a tapped point, and a mouse jumps to where it presses", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { layer, seeks, cleanup } = await renderTimeline(30);
    try {
      await act(async () => {
        pointer(layer, "pointerdown", 75, 100);
        pointer(layer, "pointerup", 75, 102);
        pointer(layer, "pointerdown", 270, 100, "mouse");
        pointer(layer, "pointerup", 270, 100, "mouse");
        await Promise.resolve();
      });
      expect(seeks).toStrictEqual([60, 216, 216]);
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});
