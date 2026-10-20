// @vitest-environment happy-dom
import { act, createElement, createRef, useState } from "react";
import type { RefObject } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  RecordingAudio,
  RecordingPlayer,
} from "@/components/practice/practice-player";
import type { PlaybackState } from "@/lib/practice";

/** A real mounted audio element; media error events are the browser boundary. */
const RetryFixture = ({
  onRetry,
  audioRef,
}: {
  onRetry: () => Promise<void>;
  audioRef: RefObject<HTMLAudioElement | null>;
}) => {
  const [failed, setFailed] = useState(false);
  return failed
    ? createElement("p", { role: "alert" }, "Recording unavailable")
    : createElement(RecordingAudio, {
        url: "https://audio.example/recording.mp3",
        rate: 1,
        audioRef,
        onPlayback: vi.fn<(state: PlaybackState) => void>(),
        onRetry,
        onFailed: () => {
          setFailed(true);
        },
      });
};

const audioIn = (container: HTMLElement): HTMLAudioElement => {
  const audio = container.querySelector("audio");
  if (audio === null) {
    throw new Error("Expected a mounted recording");
  }
  return audio;
};

describe("recording media recovery", () => {
  it("reloads an unchanged URL and reports a terminal error after its one retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const retry = vi.fn<() => Promise<void>>().mockResolvedValue();
    try {
      await act(async () => {
        root.render(
          createElement(RetryFixture, {
            onRetry: retry,
            audioRef: createRef<HTMLAudioElement>(),
          })
        );
        await Promise.resolve();
      });
      const first = audioIn(container);
      await act(async () => {
        first.dispatchEvent(new Event("error"));
        await Promise.resolve();
      });
      const replacement = audioIn(container);
      expect(replacement).not.toBe(first);
      expect(replacement.src).toBe("https://audio.example/recording.mp3");
      await act(async () => {
        replacement.dispatchEvent(new Event("error"));
        await Promise.resolve();
      });
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "Recording unavailable"
      );
      expect(retry).toHaveBeenCalledOnce();
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});

const buttonIn = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected the ${label} button`);
  }
  return button;
};

const sharedPlayer = (id: string) =>
  createElement(RecordingPlayer, {
    key: id,
    songTitle: "Example song",
    tracks: [{ id, name: "Original mix" }],
    renderAudio: (props) =>
      createElement(RecordingAudio, {
        ...props,
        url: "https://audio.example/recording.mp3",
        onRetry: async () => {
          await Promise.resolve();
        },
      }),
  });

describe("shared Practice and chord chart looping", () => {
  it("selects and adjusts a passage, loops at track end, and clears for the next recording", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(sharedPlayer("first"));
        await Promise.resolve();
      });
      await act(async () => {
        buttonIn(container, "Play").click();
        await Promise.resolve();
      });
      const audio = audioIn(container);
      Object.defineProperty(audio, "duration", { value: 120 });
      audio.currentTime = 30;
      await act(async () => {
        audio.dispatchEvent(new Event("loadedmetadata"));
        await Promise.resolve();
      });
      await act(async () => {
        buttonIn(container, "Loop section").click();
        await Promise.resolve();
      });
      const playhead = container.querySelector(
        'input[aria-label="Playback position"]'
      );
      if (playhead === null) {
        throw new Error("Expected the independent playback position handle");
      }
      await act(async () => {
        playhead.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
        );
        await Promise.resolve();
      });
      expect({
        time: audio.currentTime,
        selected: buttonIn(container, "Stop looping").getAttribute(
          "aria-pressed"
        ),
        range: container.textContent?.includes("0:30 - 0:45"),
      }).toStrictEqual({ time: 30.1, selected: "true", range: true });
      const start = container.querySelector('input[aria-label="Loop start"]');
      if (start === null) {
        throw new Error("Expected the loop start handle");
      }
      await act(async () => {
        start.dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true })
        );
        await Promise.resolve();
      });
      const pausedPlayhead = container.querySelector<HTMLInputElement>(
        'input[aria-label="Playback position"]'
      )?.value;
      const end = container.querySelector('input[aria-label="Loop end"]');
      if (end === null) {
        throw new Error("Expected the shared player's loop end handle");
      }
      await act(async () => {
        end.dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true })
        );
        await Promise.resolve();
      });
      expect(container.textContent).toContain("0:44 - 2:00");
      await act(async () => {
        audio.currentTime = 120;
        Object.defineProperty(audio, "ended", {
          value: true,
          configurable: true,
        });
        audio.dispatchEvent(new Event("ended"));
        await Promise.resolve();
      });
      expect({
        time: audio.currentTime,
        pausedPlayhead,
        playAttempts: play.mock.calls.length,
      }).toStrictEqual({
        time: 44.9,
        pausedPlayhead: "44.9",
        playAttempts: 2,
      });
      await act(async () => {
        buttonIn(container, "Stop looping").click();
        await Promise.resolve();
      });
      audio.currentTime = 80;
      audio.dispatchEvent(new Event("timeupdate"));
      expect(audio.currentTime).toBe(80);
      await act(async () => {
        buttonIn(container, "Loop section").click();
        await Promise.resolve();
      });
      await act(async () => {
        root.render(sharedPlayer("second"));
        await Promise.resolve();
      });
      expect({
        loopDisabled: buttonIn(container, "Loop section").disabled,
        playDisabled: buttonIn(container, "Play").disabled,
      }).toStrictEqual({ loopDisabled: true, playDisabled: false });
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      play.mockRestore();
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe("shared playback failure state", () => {
  it("disables stale controls after failure and recovers through the shared retry action", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          createElement(RecordingPlayer, {
            songTitle: "Example song",
            tracks: [{ id: "1", name: "Original mix" }],
            renderAudio: (props) =>
              createElement(RecordingAudio, {
                ...props,
                url: "https://audio.example/recording.mp3",
                onRetry: async () => {
                  await Promise.resolve();
                },
              }),
          })
        );
        await Promise.resolve();
      });
      await act(async () => {
        buttonIn(container, "Play").click();
        await Promise.resolve();
      });
      const first = audioIn(container);
      await act(async () => {
        first.dispatchEvent(new Event("loadedmetadata"));
        await Promise.resolve();
      });
      expect({
        disabled: buttonIn(container, "Forward 5 seconds").disabled,
      }).toStrictEqual({ disabled: false });
      await act(async () => {
        first.dispatchEvent(new Event("error"));
        await Promise.resolve();
      });
      const replacement = audioIn(container);
      await act(async () => {
        replacement.dispatchEvent(new Event("error"));
        await Promise.resolve();
      });
      expect({
        message: container.querySelector('[role="alert"]')?.textContent,
        forwardDisabled: buttonIn(container, "Forward 5 seconds").disabled,
        retryDisabled: buttonIn(container, "Retry playback").disabled,
      }).toStrictEqual({
        message:
          "This recording couldn’t play. Try again or check your access in Planning Center.",
        forwardDisabled: true,
        retryDisabled: false,
      });
      await act(async () => {
        buttonIn(container, "Retry playback").click();
        await Promise.resolve();
      });
      const recovered = audioIn(container);
      expect(recovered).not.toBe(replacement);
      await act(async () => {
        recovered.dispatchEvent(new Event("loadedmetadata"));
        await Promise.resolve();
      });
      expect({
        forwardDisabled: buttonIn(container, "Forward 5 seconds").disabled,
        playDisabled: buttonIn(container, "Play").disabled,
      }).toStrictEqual({ forwardDisabled: false, playDisabled: false });
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      play.mockRestore();
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
