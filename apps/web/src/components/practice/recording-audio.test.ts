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
