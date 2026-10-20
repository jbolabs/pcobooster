// @vitest-environment happy-dom
import { act, createElement, createRef, useState } from "react";
import type { RefObject } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { PlaybackState } from "@/components/practice/practice-player";
import { RecordingAudio } from "@/components/practice/practice-player";

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
