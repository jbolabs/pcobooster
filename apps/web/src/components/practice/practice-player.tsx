import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  AudioLines,
  ChevronDown,
  Ellipsis,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { PlaybackTimeline } from "@/components/practice/playback-timeline";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverLabel } from "@/components/ui/hover-card";
import {
  SelectionPickerOption,
  SelectionPickerShell,
} from "@/components/ui/selection-picker";
import { Spinner } from "@/components/ui/spinner";
import { useAudioLoop } from "@/hooks/use-audio-loop";
import { usePlanFileLink } from "@/hooks/use-plan-files";
import { practiceBinding } from "@/lib/app-hotkeys";
import {
  PLAYBACK_RATES,
  RECORDING_FAILURE,
  STOPPED_RECORDING as STOPPED,
  formatLoopTime,
  formatPlaybackTime,
  LOOP_STEP,
  initialLoop,
} from "@/lib/practice";
import type { LoopRegion, PlaybackState } from "@/lib/practice";
import { scrubLabel } from "@/lib/scrub";
import type { ScrubPreview } from "@/lib/scrub";

const SEEK_SECONDS = 5;

const playbackOf = (audio: HTMLAudioElement): PlaybackState => ({
  status: "ready",
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

export interface RecordingTrack {
  readonly id: string;
  readonly name: string;
}

export interface RecordingAudioProps<Track extends RecordingTrack> {
  file: Track;
  rate: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  onPlayback: (state: PlaybackState) => void;
}

/**
 * The track's audio element, mounted only once someone presses play: opening a file asks
 * Planning Center for a signed link and records a view, so it waits for clear intent. A link
 * that fails (they expire) is asked for again once, and playback picks up where it was.
 */
export const RecordingAudio = ({
  url,
  rate,
  audioRef,
  onPlayback,
  onRetry,
  onFailed,
}: Omit<RecordingAudioProps<RecordingTrack>, "file"> & {
  url: string | undefined;
  onRetry: () => Promise<void>;
  onFailed?: () => void;
}) => {
  const resumeAt = useRef(0);
  const retried = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const handleRetry = async () => {
    try {
      await onRetry();
      setAttempt((current) => current + 1);
    } catch {
      onPlayback(RECORDING_FAILURE);
      onFailed?.();
    }
  };
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
      key={`${url}:${String(attempt)}`}
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
        if (retried.current) {
          onPlayback(RECORDING_FAILURE);
          onFailed?.();
        } else {
          onPlayback({ ...STOPPED, status: "loading" });
          retried.current = true;
          void handleRetry();
        }
      }}
    />
  );
};

const TrackAudio = ({
  serviceTypeId,
  planId,
  ...props
}: RecordingAudioProps<PlanFile> & {
  serviceTypeId: string;
  planId: string;
}) => {
  const link = usePlanFileLink(serviceTypeId, planId, props.file, "link");
  const { onPlayback } = props;
  useEffect(() => {
    if (link.isError) {
      onPlayback(RECORDING_FAILURE);
    }
  }, [link.isError, onPlayback]);
  if (link.isError) {
    return null;
  }
  return (
    <RecordingAudio
      {...props}
      url={link.data?.url}
      onRetry={async () => {
        await link.refetch();
      }}
    />
  );
};

/** Keeps the shown time moving smoothly while playing. */
const usePlaybackClock = (
  audioRef: RefObject<HTMLAudioElement | null>,
  playing: boolean,
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
        onTime(audio.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [audioRef, onTime, playing]);
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
  track: RecordingTrack | undefined,
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

const loopLabel = (loop: LoopRegion | null): string =>
  loop === null ? "Loop section" : "Stop looping";

const TrackMenu = ({
  tracks,
  current,
  onChoose,
}: {
  tracks: readonly RecordingTrack[];
  current: RecordingTrack;
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

/**
 * A phone's loop switch: a loop around the playhead on or off, its start and end handles
 * then on the timeline. Touch has no hover, so it skips the desktop button's label.
 */
const PhoneLoopToggle = ({
  loop,
  disabled,
  onLoop,
}: {
  loop: LoopRegion | null;
  disabled: boolean;
  onLoop: () => void;
}) => (
  <Button
    variant={loop === null ? "ghost" : "secondary"}
    size="icon-sm"
    aria-label={loopLabel(loop)}
    aria-pressed={loop !== null}
    disabled={disabled}
    onClick={onLoop}
  >
    <Repeat2 />
  </Button>
);

/** Back, forward, loop, and speed: the controls a loaded track offers. */
const TransportControls = ({
  loaded,
  canLoop,
  loop,
  rate,
  onSeek,
  onLoop,
  onRate,
}: {
  loaded: boolean;
  canLoop: boolean;
  loop: LoopRegion | null;
  rate: number;
  onSeek: (by: number) => void;
  onLoop: () => void;
  onRate: (rate: number) => void;
}) => {
  const back = `Back ${String(SEEK_SECONDS)} seconds`;
  const forward = `Forward ${String(SEEK_SECONDS)} seconds`;
  return (
    <div className="hidden shrink-0 items-center md:order-4 md:flex">
      <HoverLabel
        label={back}
        trigger={
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
        trigger={
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
        trigger={
          <Button
            variant={loop === null ? "ghost" : "secondary"}
            size="icon-sm"
            aria-label={loopLabel(loop)}
            aria-pressed={loop !== null}
            disabled={!canLoop}
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

/**
 * Phones keep loop and speed one tap away beside the track title, as the desktop bar does;
 * the 5-second nudges share a menu.
 */
const PhonePlaybackMenu = ({
  loaded,
  canLoop,
  loop,
  rate,
  onSeek,
  onLoop,
  onRate,
}: {
  loaded: boolean;
  canLoop: boolean;
  loop: LoopRegion | null;
  rate: number;
  onSeek: (by: number) => void;
  onLoop: () => void;
  onRate: (rate: number) => void;
}) => (
  <div className="flex shrink-0 items-center md:hidden">
    <PhoneLoopToggle loop={loop} disabled={!canLoop} onLoop={onLoop} />
    <RateMenu rate={rate} onRate={onRate} />
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Playback options" />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={!loaded}
            onClick={() => {
              onSeek(-SEEK_SECONDS);
            }}
          >
            <RotateCcw />
            Back 5 seconds
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!loaded}
            onClick={() => {
              onSeek(SEEK_SECONDS);
            }}
          >
            <RotateCw />
            Forward 5 seconds
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

const playbackActionLabel = (playback: PlaybackState): string => {
  if (playback.status === "failed") {
    return "Retry playback";
  }
  return playback.playing ? "Pause" : "Play";
};

/** The audio element's playback, driven by the player's buttons, keys, and the timeline. */
const usePlayback = (rate: number, autoPlay: boolean) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [requested, setRequested] = useState(autoPlay);
  const [attempt, setAttempt] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState>(
    autoPlay ? { ...STOPPED, status: "loading" } : STOPPED
  );
  const [loop, setLoop] = useState<LoopRegion | null>(null);

  useEffect(() => {
    if (audioRef.current !== null) {
      audioRef.current.playbackRate = rate;
    }
  }, [rate]);

  const onTime = useCallback((time: number) => {
    setPlayback((current) => ({ ...current, time }));
  }, []);
  usePlaybackClock(audioRef, playback.playing, onTime);
  useAudioLoop(audioRef, loop, playback.status === "ready", onTime);

  const play = () => {
    if (playback.status === "failed") {
      setAttempt((current) => current + 1);
      setPlayback({ ...STOPPED, status: "loading" });
      setLoop(null);
      return;
    }
    const audio = audioRef.current;
    if (audio === null) {
      setRequested(true);
      setPlayback({ ...STOPPED, status: "loading" });
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
  const toggleLoop = () => {
    if (playback.duration < LOOP_STEP) {
      return;
    }
    setLoop(
      loop === null
        ? initialLoop(audioRef.current?.currentTime ?? 0, playback.duration)
        : null
    );
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
    attempt,
    playback,
    setPlayback,
    loop,
    play,
    pause,
    toggle,
    seek,
    seekTo,
    toggleLoop,
    setLoop,
    stop,
  };
};

/** Back or forward by a few seconds, the seconds drawn inside the arrow. */
const SeekButton = ({
  by,
  disabled,
  onSeek,
}: {
  by: number;
  disabled: boolean;
  onSeek: (by: number) => void;
}) => {
  const seconds = String(Math.abs(by));
  const label =
    by < 0 ? `Back ${seconds} seconds` : `Forward ${seconds} seconds`;
  const Arrow = by < 0 ? RotateCcw : RotateCw;
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="size-14 pointer-coarse:size-14"
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onSeek(by);
      }}
    >
      <span aria-hidden className="relative flex items-center justify-center">
        <Arrow className="size-8" strokeWidth={1.5} />
        <span className="absolute text-xs font-semibold tabular-nums">
          {seconds}
        </span>
      </span>
    </Button>
  );
};

const SpeedPicker = ({
  rate,
  onRate,
}: {
  rate: number;
  onRate: (rate: number) => void;
}) => (
  <fieldset className="contents">
    <legend className="sr-only">Playback speed</legend>
    <SelectionPickerShell layout="segment">
      {PLAYBACK_RATES.map((option) => (
        <SelectionPickerOption
          key={option}
          layout="segment"
          selected={option === rate}
          aria-label={`${String(option)}× speed`}
          onClick={() => {
            onRate(option);
          }}
        >
          {option}×
        </SelectionPickerOption>
      ))}
    </SelectionPickerShell>
  </fieldset>
);

const remainingLabel = (playback: PlaybackState): string =>
  playback.duration > 0
    ? `-${formatPlaybackTime(playback.duration - playback.time)}`
    : "-:--";

const FailedNotice = () => (
  <p role="alert" className="text-muted-foreground pb-2 text-sm">
    This recording couldn’t play. Try again or check your access in Planning
    Center.
  </p>
);

/**
 * Where a drag is taking the playhead, large enough to read past the finger: minutes and
 * seconds big, the tenth beside them, and the scrub speed underneath.
 */
const ScrubReadout = ({
  scrub,
  duration,
}: {
  scrub: ScrubPreview;
  duration: number;
}) => {
  const [whole, tenth] = formatLoopTime(scrub.time).split(".");
  return (
    <div className="text-foreground flex flex-col items-center gap-1">
      <p className="text-6xl font-semibold tracking-tight tabular-nums">
        {whole}
        <span className="text-muted-foreground text-3xl">.{tenth}</span>
      </p>
      <p className="text-muted-foreground text-sm">
        {scrubLabel(scrub) ?? `of ${formatPlaybackTime(duration)}`}
      </p>
    </div>
  );
};

/** The now-playing screen: the recording is the page, so every control is in reach at once. */
const PlayerStage = ({
  songTitle,
  trackName,
  trackChoice,
  audio,
  timeline,
  scrub,
  playback,
  loop,
  loopable,
  onLoop,
  rate,
  onRate,
  onToggle,
  onSeek,
}: {
  songTitle: string;
  trackName: string;
  /** A track picker when there is more than one recording; otherwise the name shows. */
  trackChoice: ReactNode | null;
  audio: ReactNode;
  timeline: ReactNode;
  /** A drag in progress on the timeline, shown large in place of the artwork. */
  scrub: ScrubPreview | null;
  playback: PlaybackState;
  loop: LoopRegion | null;
  loopable: boolean;
  onLoop: () => void;
  rate: number;
  onRate: (rate: number) => void;
  onToggle: () => void;
  onSeek: (by: number) => void;
}) => {
  const loaded = playback.status === "ready";
  return (
    <div className="flex flex-1 flex-col items-center">
      <div className="pb-safe-6 my-auto flex w-full max-w-md flex-col gap-8 px-6 pt-6">
        {audio}
        <div
          aria-hidden
          className="bg-muted text-muted-foreground flex aspect-square w-full max-w-60 items-center justify-center self-center rounded-4xl max-sm:landscape:hidden"
        >
          {scrub === null ? (
            <AudioLines className="size-20" strokeWidth={1.25} />
          ) : (
            <ScrubReadout scrub={scrub} duration={playback.duration} />
          )}
        </div>
        <div className="flex min-w-0 flex-col items-center gap-1 text-center">
          {trackChoice ?? (
            <p className="max-w-full text-xl font-semibold text-balance">
              {trackName}
            </p>
          )}
          {songTitle === trackName ? null : (
            <p className="text-muted-foreground max-w-full truncate text-sm">
              {songTitle}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {timeline}
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs tabular-nums">
            <span className="w-12">{formatPlaybackTime(playback.time)}</span>
            <Button
              variant={loop === null ? "ghost" : "secondary"}
              size="xs"
              aria-label={loopLabel(loop)}
              aria-pressed={loop !== null}
              disabled={!loopable}
              onClick={onLoop}
            >
              <Repeat2 />
              {loop === null
                ? "Loop"
                : `${formatPlaybackTime(loop.start)} - ${formatPlaybackTime(loop.end)}`}
            </Button>
            <span className="w-12 text-right">{remainingLabel(playback)}</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-6">
          <SeekButton by={-SEEK_SECONDS} disabled={!loaded} onSeek={onSeek} />
          <Button
            size="icon-xl"
            aria-label={playbackActionLabel(playback)}
            onClick={onToggle}
          >
            <PlayIcon
              loading={playback.status === "loading"}
              playing={playback.playing}
            />
          </Button>
          <SeekButton by={SEEK_SECONDS} disabled={!loaded} onSeek={onSeek} />
        </div>
        <div className="flex flex-col gap-3">
          <SpeedPicker rate={rate} onRate={onRate} />
        </div>
        {playback.status === "failed" ? <FailedNotice /> : null}
      </div>
    </div>
  );
};

/**
 * The song's recordings and rehearsal mixes: play, scrub, nudge back and forward, slow down,
 * and loop a passage. `bar` docks under a chart (the stage mounts one per item, so the next
 * song starts on its first track, stopped); `stage` is a now-playing screen for a file viewer
 * where the recording is the whole page.
 */
export const RecordingPlayer = <Track extends RecordingTrack>({
  songTitle,
  tracks,
  renderAudio,
  trackControl,
  globalControls = true,
  autoPlay = false,
  layout = "bar",
}: {
  songTitle: string;
  tracks: readonly Track[];
  renderAudio: (props: RecordingAudioProps<Track>) => ReactNode;
  trackControl?: ReactNode;
  /** Embedded previews use their own buttons without claiming page or system controls. */
  globalControls?: boolean;
  /** A user-requested restart can mount directly into playback. */
  autoPlay?: boolean;
  layout?: "bar" | "stage";
}) => {
  const [trackId, setTrackId] = useState<string | null>(null);
  const track = tracks.find((entry) => entry.id === trackId) ?? tracks[0];
  const [rate, setRate] = useState(1);
  const [scrub, setScrub] = useState<ScrubPreview | null>(null);
  const player = usePlayback(rate, autoPlay);
  const { playback, loop } = player;

  useMediaSession(songTitle, globalControls ? track : undefined, player);
  const hotkeys = {
    enabled: globalControls && track !== undefined,
    ignoreInputs: true,
  } as const;
  const loaded = playback.status === "ready";
  const loadedKeys = {
    enabled: globalControls && loaded,
    ignoreInputs: true,
  } as const;
  const loopable = loaded && playback.duration >= LOOP_STEP;
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
  useHotkey(practiceBinding("practice.loop"), player.toggleLoop, {
    enabled: globalControls && loopable,
    ignoreInputs: true,
  });

  if (track === undefined) {
    return null;
  }
  const loading = playback.status === "loading";
  const audio =
    player.requested && playback.status !== "failed" ? (
      <Fragment key={player.attempt}>
        {renderAudio({
          file: track,
          rate,
          audioRef: player.audioRef,
          onPlayback: player.setPlayback,
        })}
      </Fragment>
    ) : null;
  const trackChoice = trackControl ?? (
    <TrackMenu
      tracks={tracks}
      current={track}
      onChoose={(fileId) => {
        setTrackId(fileId);
        player.stop();
      }}
    />
  );
  const timeline = (onScrub?: (preview: ScrubPreview | null) => void) => (
    <PlaybackTimeline
      time={playback.time}
      duration={playback.duration}
      disabled={!loaded}
      loop={loop}
      onSeek={(time) => {
        player.seekTo(time);
      }}
      onLoopChange={(region) => {
        player.setLoop(region);
      }}
      onScrub={onScrub}
    />
  );

  if (layout === "stage") {
    return (
      <PlayerStage
        songTitle={songTitle}
        trackName={track.name}
        trackChoice={trackControl ?? (tracks.length > 1 ? trackChoice : null)}
        audio={audio}
        timeline={timeline(setScrub)}
        scrub={scrub}
        playback={playback}
        loop={loop}
        loopable={loopable}
        onLoop={() => {
          player.toggleLoop();
        }}
        rate={rate}
        onRate={setRate}
        onToggle={() => {
          player.toggle();
        }}
        onSeek={(by) => {
          player.seek(by);
        }}
      />
    );
  }

  return (
    <div className="bg-background sticky bottom-0 z-10">
      <div className="pb-safe-2 flex flex-col gap-1 border-t pt-2 md:flex-row md:items-center md:gap-3">
        {audio}
        <div className="flex min-w-0 items-center gap-2 md:contents">
          <Button
            size="icon"
            className="shrink-0 md:order-first"
            aria-label={playbackActionLabel(playback)}
            onClick={() => {
              player.toggle();
            }}
          >
            <PlayIcon loading={loading} playing={playback.playing} />
          </Button>
          <div className="flex min-w-0 flex-1 items-center md:order-2 md:w-56 md:flex-none">
            {trackChoice}
          </div>
          <PhonePlaybackMenu
            loaded={loaded}
            canLoop={loopable}
            loop={loop}
            rate={rate}
            onSeek={(by) => {
              player.seek(by);
            }}
            onLoop={() => {
              player.toggleLoop();
            }}
            onRate={setRate}
          />
          <TransportControls
            loaded={loaded}
            canLoop={loopable}
            loop={loop}
            rate={rate}
            onSeek={(by) => {
              player.seek(by);
            }}
            onLoop={() => {
              player.toggleLoop();
            }}
            onRate={setRate}
          />
        </div>
        <div className="flex min-w-0 items-center gap-2 md:order-3 md:flex-1">
          <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
            {formatPlaybackTime(playback.time)}
          </span>
          {timeline()}
          <span className="text-muted-foreground w-10 shrink-0 text-xs tabular-nums">
            {playback.duration > 0
              ? formatPlaybackTime(playback.duration)
              : "-:--"}
          </span>
        </div>
      </div>
      {playback.status === "failed" ? <FailedNotice /> : null}
    </div>
  );
};

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
}) => (
  <RecordingPlayer
    songTitle={songTitle}
    tracks={tracks}
    renderAudio={(props) => (
      <TrackAudio {...props} serviceTypeId={serviceTypeId} planId={planId} />
    )}
  />
);
