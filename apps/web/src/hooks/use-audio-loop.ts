import { useEffect } from "react";
import type { RefObject } from "react";

import type { LoopRegion } from "@/lib/practice";

const resumePlayback = async (audio: HTMLAudioElement) => {
  try {
    await audio.play();
  } catch {
    // The play button remains available if the browser needs another press.
  }
};

/** Foreground frames keep loops tight; media events cover background tabs and track end. */
export const useAudioLoop = (
  audioRef: RefObject<HTMLAudioElement | null>,
  loop: LoopRegion | null,
  enabled: boolean,
  onSeek: (time: number) => void
) => {
  useEffect((): (() => void) | undefined => {
    const audio = audioRef.current;
    if (audio === null || loop === null || !enabled) {
      return undefined;
    }
    const enforceLoop = () => {
      if (audio.currentTime >= loop.end || audio.currentTime < loop.start) {
        const { ended } = audio;
        audio.currentTime = loop.start;
        onSeek(audio.currentTime);
        if (ended) {
          void resumePlayback(audio);
        }
      }
    };
    let frame = 0;
    const tick = () => {
      enforceLoop();
      frame = requestAnimationFrame(tick);
    };
    const startClock = () => {
      cancelAnimationFrame(frame);
      enforceLoop();
      frame = requestAnimationFrame(tick);
    };
    const stopClock = () => {
      cancelAnimationFrame(frame);
    };
    enforceLoop();
    if (!audio.paused) {
      startClock();
    }
    audio.addEventListener("play", startClock);
    audio.addEventListener("pause", stopClock);
    audio.addEventListener("timeupdate", enforceLoop);
    audio.addEventListener("seeked", enforceLoop);
    audio.addEventListener("ended", enforceLoop);
    return () => {
      stopClock();
      audio.removeEventListener("play", startClock);
      audio.removeEventListener("pause", stopClock);
      audio.removeEventListener("timeupdate", enforceLoop);
      audio.removeEventListener("seeked", enforceLoop);
      audio.removeEventListener("ended", enforceLoop);
    };
  }, [audioRef, enabled, loop, onSeek]);
};
