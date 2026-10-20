import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverLabel } from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import { useAudioLoop } from "@/hooks/use-audio-loop";
import { usePlanFileLink } from "@/hooks/use-plan-files";
import { practiceBinding } from "@/lib/app-hotkeys";
import {
  PLAYBACK_RATES,
  RECORDING_FAILURE,
  STOPPED_RECORDING as STOPPED,
  formatPlaybackTime,
  LOOP_STEP,
  initialLoop,
} from "@/lib/practice";
import type { LoopRegion, PlaybackState } from "@/lib/practice";

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

/** Secondary controls stay in one menu on phones, leaving room for the track title. */
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
  <div className="md:hidden">
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
          <DropdownMenuItem disabled={!canLoop} onClick={onLoop}>
            <Repeat2 />
            {loopLabel(loop)}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Playback speed</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(rate)}
            onValueChange={(value) => {
              onRate(Number(value));
            }}
          >
            {PLAYBACK_RATES.map((option) => (
              <DropdownMenuRadioItem key={option} value={String(option)}>
                {option === 1 ? "Normal" : `${String(option)}×`}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

/** The audio element's playback, driven by the player's buttons, keys, and the timeline. */
const usePlayback = (rate: number) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
  usePlaybackClock(audioRef, playback.playing, onTime);
  useAudioLoop(audioRef, loop, playback.status === "ready");

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

const playbackActionLabel = (playback: PlaybackState): string => {
  if (playback.status === "failed") {
    return "Retry playback";
  }
  return playback.playing ? "Pause" : "Play";
};

/**
 * The song's recordings and rehearsal mixes in one bar: play, scrub, nudge back and forward,
 * slow down, and loop a passage. The stage mounts one per item, so the next song starts on its
 * first track, stopped.
 */
export const RecordingPlayer = <Track extends RecordingTrack>({
  songTitle,
  tracks,
  renderAudio,
  trackControl,
  globalControls = true,
}: {
  songTitle: string;
  tracks: readonly Track[];
  renderAudio: (props: RecordingAudioProps<Track>) => ReactNode;
  trackControl?: ReactNode;
  /** Embedded previews use their own buttons without claiming page or system controls. */
  globalControls?: boolean;
}) => {
  const [trackId, setTrackId] = useState<string | null>(null);
  const track = tracks.find((entry) => entry.id === trackId) ?? tracks[0];
  const [rate, setRate] = useState(1);
  const player = usePlayback(rate);
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

  return (
    <div className="bg-background sticky bottom-0 z-10">
      <div className="pb-safe-2 flex flex-col gap-1 border-t pt-2 md:flex-row md:items-center md:gap-3">
        {player.requested && playback.status !== "failed" ? (
          <Fragment key={player.attempt}>
            {renderAudio({
              file: track,
              rate,
              audioRef: player.audioRef,
              onPlayback: player.setPlayback,
            })}
          </Fragment>
        ) : null}
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
            {trackControl ?? (
              <TrackMenu
                tracks={tracks}
                current={track}
                onChoose={(fileId) => {
                  setTrackId(fileId);
                  player.stop();
                }}
              />
            )}
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
          />
          <span className="text-muted-foreground w-10 shrink-0 text-xs tabular-nums">
            {playback.duration > 0
              ? formatPlaybackTime(playback.duration)
              : "-:--"}
          </span>
        </div>
      </div>
      {playback.status === "failed" ? (
        <p role="alert" className="text-muted-foreground pb-2 text-sm">
          This recording couldn’t play. Try again or check your access in
          Planning Center.
        </p>
      ) : null}
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
