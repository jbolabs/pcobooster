import { Slider } from "@/components/ui/slider";
import { LOOP_STEP, formatPlaybackTime } from "@/lib/practice";
import type { LoopRegion } from "@/lib/practice";

/** One timeline: seeking stays independent of the overlaid A/B loop boundaries. */
export const PlaybackTimeline = ({
  time,
  duration,
  disabled,
  loop,
  onSeek,
  onLoopChange,
}: {
  time: number;
  duration: number;
  disabled: boolean;
  loop: LoopRegion | null;
  onSeek: (time: number) => void;
  onLoopChange: (loop: LoopRegion) => void;
}) => (
  <div className="relative min-w-0 flex-1">
    <Slider
      variant="scrubber"
      min={0}
      max={duration > 0 ? duration : 1}
      step={LOOP_STEP}
      value={time}
      disabled={disabled}
      thumbLabel="Playback position"
      thumbValueText={() =>
        `${formatPlaybackTime(time)} of ${formatPlaybackTime(duration)}`
      }
      onValueChange={(value: number | readonly number[]) => {
        onSeek([value].flat()[0] ?? 0);
      }}
    />
    {loop !== null && !disabled ? (
      <>
        <Slider
          variant="loop"
          className="pointer-events-none absolute inset-0"
          min={0}
          max={duration}
          step={LOOP_STEP}
          minStepsBetweenValues={1}
          thumbCollisionBehavior="none"
          value={[loop.start, loop.end]}
          thumbLabels={["Loop start", "Loop end"]}
          thumbContent={["A", "B"]}
          thumbValueText={formatPlaybackTime}
          onValueChange={(value: number | readonly number[]) => {
            const [start, end] = [value].flat();
            if (start !== undefined && end !== undefined && end > start) {
              onLoopChange({ start, end });
            }
          }}
        />
        <output className="sr-only">
          Loop {formatPlaybackTime(loop.start)} - {formatPlaybackTime(loop.end)}
          . Adjust the A and B handles to change the loop.
        </output>
      </>
    ) : null}
  </div>
);
