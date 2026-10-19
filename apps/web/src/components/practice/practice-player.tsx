import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  ChevronDown,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverLabel } from "@/components/ui/hover-card";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { usePlanFileLink } from "@/hooks/use-plan-files";
import { practiceBinding } from "@/lib/app-hotkeys";
import { PLAYBACK_RATES, formatPlaybackTime, nextLoop } from "@/lib/practice";
import type { LoopRegion } from "@/lib/practice";

const SEEK_SECONDS = 5;

interface PlaybackState {
  /** The track's audio has loaded enough to seek and loop. */
  readonly loaded: boolean;
  readonly playing: boolean;
  readonly time: number;
  readonly duration: number;
}

const STOPPED: PlaybackState = {
  loaded: false,
  playing: false,
  time: 0,
  duration: 0,
};

const playbackOf = (audio: HTMLAudioElement): PlaybackState => ({
  loaded: true,
  playing: !audio.paused,
  time: audio.currentTime,
  duration: Number.isFinite(audio.duration) ? audio.duration : 0,
});

/** Starts playback; a browser that wants another press leaves it paused, ready for one. */
const startPlayback = async (audio: HTMLAudioElement) => {
  try {
    await audio.play();
  } catch {
    // The play button still reads Play, so the next press tries again.
  }
};

/**
 * The track's audio element, mounted only once someone presses play: opening a file asks
 * Planning Center for a signed link and records a view, so it waits for clear intent. A link
 * that fails (they expire) is asked for again once, and playback picks up where it was.
 */
const TrackAudio = ({
  serviceTypeId,
  planId,
  file,
  rate,
  audioRef,
  onPlayback,
}: {
  serviceTypeId: string;
  planId: string;
  file: PlanFile;
  rate: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  onPlayback: (state: PlaybackState) => void;
}) => {
  const link = usePlanFileLink(serviceTypeId, planId, file, "link");
  const resumeAt = useRef(0);
  const retried = useRef(false);
  const url = link.data?.url;
  if (url === undefined) {
    return null;
  }
  const report = (event: { currentTarget: HTMLAudioElement }) => {
    onPlayback(playbackOf(event.currentTarget));
  };
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- Rehearsal tracks are music; there are no captions to offer.
    <audio
      ref={audioRef}
      key={url}
      src={url}
      preload="auto"
      onLoadedMetadata={(event) => {
        const audio = event.currentTarget;
        audio.playbackRate = rate;
        if (resumeAt.current > 0) {
          audio.currentTime = resumeAt.current;
        }
        report(event);
        void startPlayback(audio);
      }}
      onPlay={report}
      onPause={report}
      onEnded={report}
      onError={(event) => {
        resumeAt.current = event.currentTarget.currentTime;
        if (!retried.current) {
          retried.current = true;
          void link.refetch();
        }
      }}
    />
  );
};

/** Keeps the shown time moving smoothly while playing, and loops the marked region. */
const usePlaybackClock = (
  audioRef: RefObject<HTMLAudioElement | null>,
  playing: boolean,
  loop: LoopRegion | null,
  onTime: (time: number) => void
) => {
  useEffect((): (() => void) | undefined => {
    if (!playing) {
      return undefined;
    }
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio !== null) {
        if (
          loop !== null &&
          loop.end !== null &&
          audio.currentTime >= loop.end
        ) {
          audio.currentTime = loop.start;
        }
        onTime(audio.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [audioRef, loop, onTime, playing]);
};

interface MediaControls {
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (by: number) => void;
}

const MEDIA_ACTIONS = [
  "play",
  "pause",
  "seekbackward",
  "seekforward",
] as const satisfies readonly MediaSessionAction[];

/** Lock-screen and headphone controls name the song and run the player. */
const useMediaSession = (
  title: string,
  track: PlanFile | undefined,
  controls: MediaControls
) => {
  const controlsRef = useRef(controls);
  useEffect(() => {
    controlsRef.current = controls;
  });
  useEffect((): (() => void) | undefined => {
    if (!("mediaSession" in navigator) || track === undefined) {
      return undefined;
    }
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({ title, artist: track.name });
    const handlers: Record<(typeof MEDIA_ACTIONS)[number], () => void> = {
      play: () => {
        controlsRef.current.play();
      },
      pause: () => {
        controlsRef.current.pause();
      },
      seekbackward: () => {
        controlsRef.current.seek(-SEEK_SECONDS);
      },
      seekforward: () => {
        controlsRef.current.seek(SEEK_SECONDS);
      },
    };
    for (const action of MEDIA_ACTIONS) {
      session.setActionHandler(action, handlers[action]);
    }
    return () => {
      session.metadata = null;
      for (const action of MEDIA_ACTIONS) {
        session.setActionHandler(action, null);
      }
    };
  }, [title, track]);
};

const loopLabel = (loop: LoopRegion | null): string => {
  if (loop === null) {
    return "Loop from here";
  }
  return loop.end === null ? "Loop to here" : "Stop looping";
};

const percentOf = (time: number, duration: number) =>
  `${String((time / duration) * 100)}%`;

/** The marked loop drawn on the timeline. */
const LoopMarks = ({
  loop,
  duration,
}: {
  loop: LoopRegion | null;
  duration: number;
}) => {
  if (loop === null || duration <= 0) {
    return null;
  }
  const region: CSSProperties & Record<`--loop-${string}`, string> = {
    "--loop-start": percentOf(loop.start, duration),
    "--loop-width": percentOf((loop.end ?? loop.start) - loop.start, duration),
  };
  return (
    <span
      aria-hidden
      className="bg-status-info/70 absolute inset-y-0 left-(--loop-start) w-(--loop-width) min-w-0.5"
      style={region}
    />
  );
};

const TrackMenu = ({
  tracks,
  current,
  onChoose,
}: {
  tracks: readonly PlanFile[];
  current: PlanFile;
  onChoose: (fileId: string) => void;
}) => {
  if (tracks.length === 1) {
    return (
      <span className="min-w-0 truncate px-2 text-sm font-medium">
        {current.name}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 justify-start"
            aria-label={`Track: ${current.name}. Choose another`}
          />
        }
      >
        <span className="truncate">{current.name}</span>
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72">
        <DropdownMenuRadioGroup value={current.id} onValueChange={onChoose}>
          {tracks.map((track) => (
            <DropdownMenuRadioItem key={track.id} value={track.id}>
              <span className="truncate">{track.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const RateMenu = ({
  rate,
  onRate,
}: {
  rate: number;
  onRate: (rate: number) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Speed ${String(rate)}×. Change speed`}
        />
      }
    >
      <span className="tabular-nums">{rate}×</span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup
        value={String(rate)}
        onValueChange={(value: string) => {
          onRate(Number(value));
        }}
      >
        {PLAYBACK_RATES.map((option) => (
          <DropdownMenuRadioItem key={option} value={String(option)}>
            {option === 1 ? "Normal" : `${String(option)}×`}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** The play button's icon: a spinner while the link resolves. */
const PlayIcon = ({
  loading,
  playing,
}: {
  loading: boolean;
  playing: boolean;
}) => {
  if (loading) {
    return <Spinner />;
  }
  return playing ? <Pause /> : <Play />;
};

/** Back, forward, loop, and speed: the controls a loaded track offers. */
const TransportControls = ({
  loaded,
  loop,
  rate,
  onSeek,
  onLoop,
  onRate,
}: {
  loaded: boolean;
  loop: LoopRegion | null;
  rate: number;
  onSeek: (by: number) => void;
  onLoop: () => void;
  onRate: (rate: number) => void;
}) => {
  const back = `Back ${String(SEEK_SECONDS)} seconds`;
  const forward = `Forward ${String(SEEK_SECONDS)} seconds`;
  return (
    <div className="flex shrink-0 items-center sm:order-4">
      <HoverLabel
        label={back}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={back}
            disabled={!loaded}
            onClick={() => {
              onSeek(-SEEK_SECONDS);
            }}
          />
        }
      >
        <RotateCcw />
      </HoverLabel>
      <HoverLabel
        label={forward}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={forward}
            disabled={!loaded}
            onClick={() => {
              onSeek(SEEK_SECONDS);
            }}
          />
        }
      >
        <RotateCw />
      </HoverLabel>
      <HoverLabel
        label={loopLabel(loop)}
        render={
          <Button
            variant={loop === null ? "ghost" : "secondary"}
            size="icon-sm"
            aria-label={loopLabel(loop)}
            aria-pressed={loop !== null}
            disabled={!loaded}
            onClick={onLoop}
          />
        }
      >
        <Repeat2 />
      </HoverLabel>
      <RateMenu rate={rate} onRate={onRate} />
    </div>
  );
};

/** The audio element's playback, driven by the player's buttons, keys, and the timeline. */
const usePlayback = (rate: number) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [requested, setRequested] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState>(STOPPED);
  const [loop, setLoop] = useState<LoopRegion | null>(null);

  useEffect(() => {
    if (audioRef.current !== null) {
      audioRef.current.playbackRate = rate;
    }
  }, [rate]);

  const onTime = useCallback((time: number) => {
    setPlayback((current) => ({ ...current, time }));
  }, []);
  usePlaybackClock(audioRef, playback.playing, loop, onTime);

  const play = () => {
    const audio = audioRef.current;
    if (audio === null) {
      setRequested(true);
      return;
    }
    void startPlayback(audio);
  };
  const pause = () => {
    audioRef.current?.pause();
  };
  const seekTo = (time: number) => {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    const end = playback.duration > 0 ? playback.duration : time;
    audio.currentTime = Math.min(Math.max(time, 0), end);
    onTime(audio.currentTime);
  };
  const seek = (by: number) => {
    seekTo((audioRef.current?.currentTime ?? 0) + by);
  };
  const markLoop = () => {
    const next = nextLoop(loop, audioRef.current?.currentTime ?? 0);
    setLoop(next);
    if (next !== null && next.end !== null) {
      seekTo(next.start);
    }
  };
  const stop = () => {
    setRequested(false);
    setPlayback(STOPPED);
    setLoop(null);
  };
  const toggle = () => {
    if (playback.playing) {
      pause();
    } else {
      play();
    }
  };
  return {
    audioRef,
    requested,
    playback,
    setPlayback,
    loop,
    play,
    pause,
    toggle,
    seek,
    seekTo,
    markLoop,
    stop,
  };
};

/**
 * The song's recordings and rehearsal mixes in one bar: play, scrub, nudge back and forward,
 * slow down, and loop a passage. The stage mounts one per item, so the next song starts on its
 * first track, stopped.
 */
export const PracticePlayer = ({
  serviceTypeId,
  planId,
  songTitle,
  tracks,
}: {
  serviceTypeId: string;
  planId: string;
  songTitle: string;
  tracks: readonly PlanFile[];
}) => {
  const [trackId, setTrackId] = useState<string | null>(null);
  const track = tracks.find((entry) => entry.id === trackId) ?? tracks[0];
  const [rate, setRate] = useState(1);
  const player = usePlayback(rate);
  const { playback, loop } = player;

  useMediaSession(songTitle, track, player);
  const hotkeys = { enabled: track !== undefined, ignoreInputs: true } as const;
  const loadedKeys = { enabled: playback.loaded, ignoreInputs: true } as const;
  useHotkey(practiceBinding("practice.play"), player.toggle, {
    ...hotkeys,
    preventDefault: true,
  });
  useHotkey(
    practiceBinding("practice.back"),
    () => {
      player.seek(-SEEK_SECONDS);
    },
    loadedKeys
  );
  useHotkey(
    practiceBinding("practice.forward"),
    () => {
      player.seek(SEEK_SECONDS);
    },
    loadedKeys
  );
  useHotkey(practiceBinding("practice.loop"), player.markLoop, loadedKeys);

  if (track === undefined) {
    return null;
  }
  const loading = player.requested && !playback.loaded;
  const timeText = `${formatPlaybackTime(playback.time)} of ${formatPlaybackTime(playback.duration)}`;

  return (
    <div className="bg-background pb-safe-2 sticky bottom-0 z-10 flex flex-col gap-1 border-t pt-2 sm:flex-row sm:items-center sm:gap-3">
      {player.requested ? (
        <TrackAudio
          key={track.id}
          serviceTypeId={serviceTypeId}
          planId={planId}
          file={track}
          rate={rate}
          audioRef={player.audioRef}
          onPlayback={(state) => {
            player.setPlayback(state);
          }}
        />
      ) : null}
      <div className="flex min-w-0 items-center gap-2 sm:contents">
        <Button
          size="icon"
          className="shrink-0 sm:order-first"
          aria-label={playback.playing ? "Pause" : "Play"}
          onClick={() => {
            player.toggle();
          }}
        >
          <PlayIcon loading={loading} playing={playback.playing} />
        </Button>
        <div className="flex min-w-0 flex-1 items-center sm:order-2 sm:w-56 sm:flex-none">
          <TrackMenu
            tracks={tracks}
            current={track}
            onChoose={(fileId) => {
              setTrackId(fileId);
              player.stop();
            }}
          />
        </div>
        <TransportControls
          loaded={playback.loaded}
          loop={loop}
          rate={rate}
          onSeek={(by) => {
            player.seek(by);
          }}
          onLoop={() => {
            player.markLoop();
          }}
          onRate={setRate}
        />
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:order-3 sm:flex-1">
        <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
          {formatPlaybackTime(playback.time)}
        </span>
        <Slider
          variant="scrubber"
          min={0}
          max={playback.duration > 0 ? playback.duration : 1}
          step={0.1}
          value={playback.time}
          disabled={!playback.loaded}
          thumbLabel="Playback position"
          thumbValueText={() => timeText}
          track={<LoopMarks loop={loop} duration={playback.duration} />}
          onValueChange={(value: number | readonly number[]) => {
            player.seekTo([value].flat()[0] ?? 0);
          }}
        />
        <span className="text-muted-foreground w-10 shrink-0 text-xs tabular-nums">
          {playback.duration > 0
            ? formatPlaybackTime(playback.duration)
            : "-:--"}
        </span>
      </div>
    </div>
  );
};
