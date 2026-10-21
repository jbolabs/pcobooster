// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import {
  RecordingAudio,
  RecordingPlayer,
} from "@/components/practice/practice-player";
import { LoopingAudioPlayer } from "@/components/schedule/looping-audio-player";

interface TestMediaSession {
  metadata: MediaMetadata | null;
  setActionHandler: () => void;
}

class TestMediaMetadata {
  readonly title: string;
  constructor({ title }: { title: string }) {
    this.title = title;
  }
}

const mainPlayer = createElement(RecordingPlayer, {
  songTitle: "Main song",
  tracks: [{ id: "main", name: "Original mix" }],
  renderAudio: (props) =>
    createElement(RecordingAudio, {
      ...props,
      url: "https://audio.example/main.mp3",
      onRetry: async () => {
        await Promise.resolve();
      },
    }),
});

const RefreshedPreview = () => {
  const [url, setUrl] = useState("https://audio.example/old.mp3");
  return createElement(LoopingAudioPlayer, {
    key: "file",
    fileId: "file",
    url,
    name: "Preview",
    onRetry: async () => {
      setUrl("https://audio.example/fresh.mp3");
      await Promise.resolve();
    },
    onFailed: () => {},
  });
};

describe("embedded audio preview ownership and recovery", () => {
  it("leaves document shortcuts and system media controls with the main player", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("MediaMetadata", TestMediaMetadata);
    const descriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaSession"
    );
    const session: TestMediaSession = {
      metadata: null,
      setActionHandler: () => {},
    };
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: session,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          createElement(
            "div",
            null,
            mainPlayer,
            createElement(RefreshedPreview)
          )
        );
        await Promise.resolve();
      });
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: " ",
            code: "Space",
            bubbles: true,
          })
        );
        document.dispatchEvent(
          new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true })
        );
        await Promise.resolve();
      });
      expect({
        requested: container.querySelectorAll("audio").length,
        source: container.querySelector("audio")?.src,
        systemTitle: session.metadata?.title,
      }).toStrictEqual({
        requested: 1,
        source: "https://audio.example/main.mp3",
        systemTitle: "Main song",
      });
      await act(async () => {
        root.render(createElement("div", null, mainPlayer));
        await Promise.resolve();
      });
      expect(session.metadata?.title).toBe("Main song");
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      if (descriptor === undefined) {
        Reflect.deleteProperty(navigator, "mediaSession");
      } else {
        Object.defineProperty(navigator, "mediaSession", descriptor);
      }
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps the playhead and loop while retrying with a fresh signed URL", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const requiredAudio = () => {
      const audio = container.querySelector("audio");
      if (audio === null) {
        throw new Error("Expected requested preview audio");
      }
      return audio;
    };
    try {
      await act(async () => {
        root.render(createElement(RefreshedPreview));
        await Promise.resolve();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Play"]')
          ?.click();
        await Promise.resolve();
      });
      const first = requiredAudio();
      Object.defineProperty(first, "duration", { value: 120 });
      first.currentTime = 40;
      await act(async () => {
        first.dispatchEvent(new Event("loadedmetadata"));
        await Promise.resolve();
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Loop section"]')
          ?.click();
        await Promise.resolve();
      });
      await act(async () => {
        first.dispatchEvent(new Event("error"));
        await Promise.resolve();
      });
      const recovered = requiredAudio();
      Object.defineProperty(recovered, "duration", { value: 120 });
      await act(async () => {
        recovered.dispatchEvent(new Event("loadedmetadata"));
        await Promise.resolve();
      });
      expect({
        source: recovered.src,
        time: recovered.currentTime,
        loop: container.querySelector("output")?.textContent,
      }).toStrictEqual({
        source: "https://audio.example/fresh.mp3",
        time: 40,
        loop: "Loop 0:40 - 0:55. Drag the start and end handles to change the loop.",
      });
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
