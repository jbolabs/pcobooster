// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { LoopingAudioPlayer } from "@/components/schedule/looping-audio-player";

const view = (id: string) =>
  createElement(LoopingAudioPlayer, {
    key: id,
    fileId: id,
    url: `https://audio.example/${id}.mp3`,
    name: "Rehearsal mix",
    onRetry: async () => {
      await Promise.resolve();
    },
    onFailed: () => {},
  });

const buttonIn = (container: HTMLElement, name: string) => {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${name}"]`
  );
  if (button === null) {
    throw new Error(`Expected the ${name} button`);
  }
  return button;
};

/** Plays on to `time` and reports where the playhead ends up after the loop has its say. */
const playTo = async (audio: HTMLAudioElement, time: number) => {
  await act(async () => {
    audio.currentTime = time;
    audio.dispatchEvent(new Event("timeupdate"));
    await Promise.resolve();
  });
  return audio.currentTime;
};

/** A finger on the timeline, which the test lays out 300px wide with its center at y = 100. */
const touch = (container: HTMLElement, type: string, x: number, y = 100) => {
  const layer = container.querySelector(".cursor-pointer.touch-none");
  if (!(layer instanceof HTMLElement)) {
    throw new Error("Expected the scrub layer");
  }
  layer.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: 90, width: 300, height: 20 });
  layer.setPointerCapture = () => {};
  layer.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: "touch",
      clientX: x,
      clientY: y,
    })
  );
};

const mountPlaying = async (container: HTMLElement) => {
  const root = createRoot(container);
  await act(async () => {
    root.render(view("first"));
    await Promise.resolve();
  });
  const loopDisabled = buttonIn(container, "Loop section").disabled;
  await act(async () => {
    buttonIn(container, "Play").click();
    await Promise.resolve();
  });
  const audio = container.querySelector("audio");
  if (audio === null) {
    throw new Error("Expected the audio player");
  }
  await act(async () => {
    Object.defineProperty(audio, "duration", {
      value: 120,
      configurable: true,
    });
    audio.currentTime = 30;
    audio.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();
  });
  return { root, audio, loopDisabled };
};

describe("media passage looping", () => {
  it("loops around the playhead, drags B on the timeline with fine control, and resets for another file", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    const { root, audio, loopDisabled } = await mountPlaying(container);
    try {
      await act(async () => {
        buttonIn(container, "Loop section").click();
        await Promise.resolve();
      });
      const wrapped = await playTo(audio, 45.2);
      await act(async () => {
        // B at 0:45 of 2:00 sits at 112.5px. Slide 120px away (a quarter speed), then 100px
        // right: a third of the bar is 40s, a quarter of that is 10s, so B moves to 0:55.
        touch(container, "pointerdown", 112);
        touch(container, "pointermove", 112, 220);
        touch(container, "pointermove", 212, 220);
        await Promise.resolve();
      });
      const readout = container.textContent?.includes("0:55.0Loop end · 0.25×");
      await act(async () => {
        touch(container, "pointerup", 212, 220);
        await Promise.resolve();
      });
      const loopLabel = buttonIn(container, "Stop looping").textContent;
      const stillLooping = await playTo(audio, 55.1);
      await act(async () => {
        buttonIn(container, "Stop looping").click();
        await Promise.resolve();
      });
      const free = await playTo(audio, 80);
      expect({
        loopDisabled,
        wrapped,
        readout,
        loopLabel,
        stillLooping,
        free,
      }).toStrictEqual({
        loopDisabled: true,
        wrapped: 30,
        readout: true,
        loopLabel: "0:30 - 0:55",
        stillLooping: 30,
        free: 80,
      });

      await act(async () => {
        buttonIn(container, "Loop section").click();
        root.render(view("second"));
        await Promise.resolve();
      });
      expect({
        disabled: buttonIn(container, "Loop section").disabled,
      }).toStrictEqual({ disabled: true });
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      play.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("shows where a drag is taking the playhead in large type, then the artwork again", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    const { root } = await mountPlaying(container);
    try {
      await act(async () => {
        // A quarter of a 300px bar is a quarter of 2:00: from 0:30 to 1:00.
        touch(container, "pointerdown", 150);
        touch(container, "pointermove", 225);
        await Promise.resolve();
      });
      const during = container.textContent;
      await act(async () => {
        touch(container, "pointerup", 225);
        await Promise.resolve();
      });
      expect({
        readout: during?.includes("1:00.01×"),
        after: container.textContent?.includes("1:00.0"),
      }).toStrictEqual({ readout: true, after: false });
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      play.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
