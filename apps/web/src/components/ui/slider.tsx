import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ReactNode } from "react";

const sliderTrackVariants = cva(
  "relative grow overflow-hidden rounded-full select-none data-horizontal:w-full data-vertical:h-full",
  {
    variants: {
      variant: {
        default: "bg-input/90 data-horizontal:h-2 data-vertical:w-2",
        /** A thin media timeline, such as a player's progress. */
        scrubber: "bg-input/90 data-horizontal:h-1 data-vertical:w-1",
        loop: "bg-transparent data-horizontal:h-1 data-vertical:w-1",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

const sliderThumbVariants = cva(
  "hover:ring-ring/30 focus-visible:ring-ring/30 block shrink-0 bg-white shadow-md ring-1 ring-black/10 transition-[box-shadow] select-none not-dark:bg-clip-padding hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "h-4 w-6 rounded-full data-vertical:h-6 data-vertical:w-4",
        scrubber: "size-3 rounded-full",
        loop: "pointer-events-auto flex h-5 w-3 items-center justify-center rounded-sm text-[8px] font-semibold",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

const Slider = ({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  variant = "default",
  track,
  thumbLabel,
  thumbLabels,
  thumbContent,
  thumbValueText,
  ...props
}: SliderPrimitive.Root.Props &
  VariantProps<typeof sliderTrackVariants> & {
    /** Marks drawn inside the track, over the filled range, such as a loop region. */
    track?: ReactNode;
    /** What the thumb sets, for screen readers, such as "Playback position". */
    thumbLabel?: string;
    /** Per-thumb names for a range, in order. */
    thumbLabels?: readonly string[];
    /** Short visible markers inside range handles, such as A and B. */
    thumbContent?: readonly ReactNode[];
    /** The value read aloud, such as `1:05 of 4:10`. */
    thumbValueText?: (value: number) => string;
  }) => {
  let values: readonly number[] = [min, max];
  if (Array.isArray(value)) {
    values = value;
  } else if (Array.isArray(defaultValue)) {
    values = defaultValue;
  } else if (value !== undefined || defaultValue !== undefined) {
    values = [min];
  }

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1.5 select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={sliderTrackVariants({ variant })}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              "select-none data-horizontal:h-full data-vertical:w-full",
              variant === "loop" ? "bg-status-info/40" : "bg-primary"
            )}
          />
          {track}
        </SliderPrimitive.Track>
        {values.map((_thumb, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            // Thumbs have no identity but their order.
            key={`thumb-${String(index)}-${String(values.length)}`}
            aria-label={thumbLabels?.[index] ?? thumbLabel}
            getAriaValueText={
              thumbValueText === undefined
                ? undefined
                : (_formatted, thumbValue) => thumbValueText(thumbValue)
            }
            className={sliderThumbVariants({ variant })}
          >
            {thumbContent?.[index]}
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
};

export { Slider };
