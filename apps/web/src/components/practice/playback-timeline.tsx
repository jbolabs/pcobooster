import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";

import { Slider } from "@/components/ui/slider";
import { LOOP_STEP, formatPlaybackTime } from "@/lib/practice";
import type { LoopEdge, LoopRegion } from "@/lib/practice";
import {
  edgeAtPoint,
  placeEdge,
  scrubBy,
  scrubLabel,
  scrubRate,
  timeAtPoint,
} from "@/lib/scrub";
import type { ScrubPreview } from "@/lib/scrub";
import { cn } from "@/lib/utils";

/** How often a drag seeks the audio, so the passage under the finger is audible. */
const LIVE_SEEK_MS = 90;
/** Pointer travel under this many pixels is a tap, which seeks to the tapped point. */
const TAP_SLOP = 6;
/** How near a loop handle a press must land to grab it, by pointer. */
const HANDLE_REACH = { touch: 22, mouse: 8 } as const;

interface Drag {
  readonly pointerId: number;
  readonly touch: boolean;
  /** The loop handle being dragged; null drags the playhead. */
  readonly edge: LoopEdge | null;
  readonly startX: number;
  readonly startY: number;
  readonly centerY: number;
  readonly left: number;
  readonly width: number;
  lastX: number;
  time: number;
  moved: boolean;
  lastSeek: number;
}

/**
 * Pointer scrubbing over the timeline, for the playhead and the loop's start and end handles. A
 * press near a handle grabs it; anywhere else grabs the playhead. A mouse jumps to the click
 * and tracks the cursor; a finger grabs what it lands on where it is (no jump) and moves it
 * by how far it travels, slower the farther it slides from the bar. A tap without a drag seeks
 * to the tap.
 */
const useScrub = ({
  time,
  duration,
  loop,
  onSeek,
  onLoopChange,
  onScrub,
}: {
  time: number;
  duration: number;
  loop: LoopRegion | null;
  onSeek: (time: number) => void;
  onLoopChange: (loop: LoopRegion) => void;
  onScrub?: (preview: ScrubPreview | null) => void;
}) => {
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<ScrubPreview | null>(null);
  const showPreview = (next: ScrubPreview | null) => {
    setPreview(next);
    onScrub?.(next);
  };
  const [hover, setHover] = useState<number | null>(null);

  /** Moves what the drag holds to `target`, returning where it landed. */
  const moveTo = (current: Drag, target: number, at: number): number => {
    if (current.edge === null) {
      if (at - current.lastSeek >= LIVE_SEEK_MS) {
        current.lastSeek = at;
        onSeek(target);
      }
      return target;
    }
    if (loop === null) {
      return target;
    }
    const placed = placeEdge(loop, current.edge, target, duration);
    onLoopChange(placed);
    return placed[current.edge];
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { current } = drag;
    if (current?.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    if (current.touch && !current.moved) {
      onSeek(timeAtPoint(event.clientX, current, duration));
    } else if (current.edge === null) {
      onSeek(current.time);
    }
    showPreview(null);
  };

  return {
    preview,
    hover,
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || duration <= 0) {
          return;
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        const touch = event.pointerType !== "mouse";
        const edge =
          loop === null
            ? null
            : edgeAtPoint({
                x: event.clientX,
                bounds,
                loop,
                duration,
                reach: touch ? HANDLE_REACH.touch : HANDLE_REACH.mouse,
              });
        let start = touch ? time : timeAtPoint(event.clientX, bounds, duration);
        if (edge !== null && loop !== null) {
          start = loop[edge];
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          touch,
          edge,
          startX: event.clientX,
          startY: event.clientY,
          centerY: bounds.top + bounds.height / 2,
          left: bounds.left,
          width: bounds.width,
          lastX: event.clientX,
          time: start,
          moved: false,
          lastSeek: event.timeStamp,
        };
        if (!touch && edge === null) {
          onSeek(start);
        }
        setHover(null);
        showPreview({ time: start, rate: 1, edge, touch });
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        const { current } = drag;
        if (current?.pointerId !== event.pointerId) {
          if (event.pointerType === "mouse" && duration > 0) {
            setHover(
              timeAtPoint(
                event.clientX,
                event.currentTarget.getBoundingClientRect(),
                duration
              )
            );
          }
          return;
        }
        if (
          Math.abs(event.clientX - current.startX) > TAP_SLOP ||
          Math.abs(event.clientY - current.startY) > TAP_SLOP
        ) {
          current.moved = true;
        }
        const rate = scrubRate(event.clientY - current.centerY);
        const target =
          !current.touch && rate === 1
            ? timeAtPoint(event.clientX, current, duration)
            : scrubBy({
                time: current.time,
                dx: event.clientX - current.lastX,
                width: current.width,
                duration,
                rate,
              });
        current.lastX = event.clientX;
        current.time = moveTo(current, target, event.timeStamp);
        showPreview({
          time: current.time,
          rate,
          edge: current.edge,
          touch: current.touch,
        });
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onPointerLeave: () => {
        setHover(null);
      },
    },
  };
};

const percentOf = (time: number, duration: number): number =>
  duration > 0 ? (time / duration) * 100 : 0;

/**
 * A time pinned above a point on the timeline, kept inside the bar's ends; a drag adds what it
 * holds and its rate, such as `1:30 Loop end · 0.25×`.
 */
const TimeBubble = ({
  time,
  duration,
  label,
  strong,
}: {
  time: number;
  duration: number;
  label: string | null;
  strong: boolean;
}) => {
  const position: CSSProperties & { "--bubble-at": string } = {
    "--bubble-at": `${String(percentOf(time, duration))}%`,
  };
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute bottom-full z-20 mb-2 flex -translate-x-1/2 items-baseline gap-1.5 rounded-md px-2 py-0.5 text-sm font-semibold whitespace-nowrap tabular-nums shadow-md",
        label === null
          ? "left-[clamp(1.5rem,var(--bubble-at),calc(100%-1.5rem))]"
          : "left-[clamp(5.5rem,var(--bubble-at),calc(100%-5.5rem))]",
        strong
          ? "bg-foreground text-background"
          : "bg-popover text-popover-foreground ring-foreground/10 ring-1"
      )}
      style={position}
    >
      {formatPlaybackTime(time)}
      {label === null ? null : (
        <span className="text-xs font-medium opacity-70">{label}</span>
      )}
    </div>
  );
};

/**
 * One timeline: seeking stays independent of the overlaid loop boundaries. The sliders
 * draw the bar and the handles and take the keyboard; one pointer layer between them scrubs
 * the playhead and both handles, so every drag gets the same fine control.
 */
export const PlaybackTimeline = ({
  time,
  duration,
  disabled,
  loop,
  onSeek,
  onLoopChange,
  onScrub,
}: {
  time: number;
  duration: number;
  disabled: boolean;
  loop: LoopRegion | null;
  onSeek: (time: number) => void;
  onLoopChange: (loop: LoopRegion) => void;
  /** Follows a drag, for a player that shows the scrub itself in place of the bubble and hint. */
  onScrub?: (preview: ScrubPreview | null) => void;
}) => {
  const scrub = useScrub({
    time,
    duration,
    loop,
    onSeek,
    onLoopChange,
    onScrub,
  });
  const playheadDrag =
    scrub.preview !== null && scrub.preview.edge === null
      ? scrub.preview
      : null;
  const shown = playheadDrag?.time ?? time;
  const label = scrub.preview === null ? null : scrubLabel(scrub.preview);
  return (
    <div
      className="group/timeline relative min-w-0 flex-1"
      data-scrubbing={playheadDrag === null ? undefined : ""}
    >
      <Slider
        variant="scrubber"
        min={0}
        max={duration > 0 ? duration : 1}
        step={LOOP_STEP}
        value={shown}
        disabled={disabled}
        thumbLabel="Playback position"
        thumbValueText={() =>
          `${formatPlaybackTime(shown)} of ${formatPlaybackTime(duration)}`
        }
        onValueChange={(value: number | readonly number[]) => {
          onSeek([value].flat()[0] ?? 0);
        }}
      />
      {disabled ? null : (
        <div
          aria-hidden
          className="absolute inset-x-0 -inset-y-3 cursor-pointer touch-none"
          {...scrub.handlers}
        />
      )}
      {scrub.preview === null || onScrub !== undefined ? null : (
        <TimeBubble
          time={scrub.preview.time}
          duration={duration}
          label={label}
          strong
        />
      )}
      {scrub.hover === null ? null : (
        <TimeBubble
          time={scrub.hover}
          duration={duration}
          label={null}
          strong={false}
        />
      )}
      {loop !== null && !disabled ? (
        <>
          <Slider
            variant="loop"
            className="pointer-events-none absolute inset-0 z-10"
            min={0}
            max={duration}
            step={LOOP_STEP}
            minStepsBetweenValues={1}
            thumbCollisionBehavior="none"
            value={[loop.start, loop.end]}
            thumbLabels={["Loop start", "Loop end"]}
            thumbValueText={formatPlaybackTime}
            onValueChange={(value: number | readonly number[]) => {
              const [start, end] = [value].flat();
              if (start !== undefined && end !== undefined && end > start) {
                onLoopChange({ start, end });
              }
            }}
          />
          <output className="sr-only">
            Loop {formatPlaybackTime(loop.start)} -{" "}
            {formatPlaybackTime(loop.end)}. Drag the start and end handles to
            change the loop.
          </output>
        </>
      ) : null}
    </div>
  );
};
