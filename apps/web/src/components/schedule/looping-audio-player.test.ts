// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { LoopingAudioPlayer } from "@/components/schedule/looping-audio-player";

const view = (id: string) =>
  createElement(LoopingAudioPlayer, {
    key: id,
    url: `https://audio.example/${id}.mp3`,
    name: "Rehearsal mix",
    onRetry: async () => {
      await Promise.resolve();
    },
    onFailed: () => {},
  });

describe("media passage looping", () => {
  it("repeats an adjustable passage, stops looping, and resets for another file", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const button = () => {
      const element = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Loop section"], button[aria-label="Stop looping"]'
      );
      if (element === null) {
        throw new Error("Expected the loop button");
      }
      return element;
    };
    try {
      await act(async () => {
        await Promise.resolve();
        root.render(view("first"));
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Play"]')
          ?.click();
        await Promise.resolve();
      });
      const audio = container.querySelector("audio");
      if (audio === null) {
        throw new Error("Expected the audio player");
      }
      expect({ disabled: button().disabled }).toStrictEqual({ disabled: true });
      await act(async () => {
        await Promise.resolve();
        Object.defineProperty(audio, "duration", {
          value: 120,
          configurable: true,
        });
        audio.dispatchEvent(new Event("loadedmetadata"));
      });
      audio.currentTime = 30;
      await act(async () => {
        await Promise.resolve();
        button().click();
      });

      await act(async () => {
        await Promise.resolve();
        audio.currentTime = 45.2;
        audio.dispatchEvent(new Event("timeupdate"));
      });
      expect({
        time: audio.currentTime,
        looping: button().getAttribute("aria-label"),
        range: container.textContent?.includes("0:30 - 0:45"),
      }).toStrictEqual({ time: 30, looping: "Stop looping", range: true });
      const end = container.querySelector('input[aria-label="Loop end"]');
      if (end === null) {
        throw new Error("Expected a labeled loop end handle");
      }
      await act(async () => {
        await Promise.resolve();
        end.dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true })
        );
      });

      await act(async () => {
        await Promise.resolve();
        audio.currentTime = 120;
        audio.dispatchEvent(new Event("timeupdate"));
      });
      expect({
        time: audio.currentTime,
        range: container.textContent?.includes("0:30 - 2:00"),
      }).toStrictEqual({ time: 30, range: true });
      await act(async () => {
        await Promise.resolve();
        button().click();
      });
      await act(async () => {
        await Promise.resolve();
        audio.currentTime = 80;
        audio.dispatchEvent(new Event("timeupdate"));
      });
      expect({
        time: audio.currentTime,
        label: button().getAttribute("aria-label"),
      }).toStrictEqual({ time: 80, label: "Loop section" });
      await act(async () => {
        await Promise.resolve();
        button().click();
        root.render(view("second"));
      });
      expect({
        label: button().getAttribute("aria-label"),
        disabled: button().disabled,
      }).toStrictEqual({
        label: "Loop section",
        disabled: true,
      });
    } finally {
      await act(async () => {
        await Promise.resolve();
        root.unmount();
      });
      container.remove();
      play.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
