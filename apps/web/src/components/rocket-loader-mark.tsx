import { cn } from "cn";
import type { ComponentProps, Ref } from "react";
import { useId } from "react";

import {
  ROCKET_FIN_PATHS,
  ROCKET_FLUTES,
  ROCKET_HULL_PATH,
  ROCKET_TILT,
  ROCKET_VIEW_BOX,
  ROCKET_WINDOW,
} from "@/lib/rocket-geometry";

type RocketLoaderMarkProps = ComponentProps<"svg"> & {
  /** The group that carries the hull and its exhaust, for scripted motion. */
  readonly shipRef?: Ref<SVGGElement>;
};

/**
 * The rocket logo built for motion: the hull plus three exhaust flutes whose bars and dots
 * a `--rocket-len` value stretches together. Pair it with a motion utility from
 * `globals.css` (`rocket-puff`, `rocket-hover`); it inherits the text color.
 */
export const RocketLoaderMark = ({
  shipRef,
  className,
  ...props
}: RocketLoaderMarkProps) => {
  const maskId = useId().replaceAll(":", "");

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={ROCKET_VIEW_BOX}
      fill="currentColor"
      className={cn("rocket-mark overflow-visible", className)}
      {...props}
    >
      <defs>
        <mask
          id={`${maskId}-fins`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="256"
          height="256"
        >
          <rect
            width="256"
            height="256"
            fill="var(--color-pc-services-foreground)"
          />
          <path
            d={ROCKET_HULL_PATH}
            fill="var(--color-overlay-shadow)"
            stroke="var(--color-overlay-shadow)"
            strokeWidth="12"
            strokeLinejoin="round"
          />
        </mask>
        <mask
          id={`${maskId}-window`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="256"
          height="256"
        >
          <rect
            width="256"
            height="256"
            fill="var(--color-pc-services-foreground)"
          />
          <circle {...ROCKET_WINDOW} fill="var(--color-overlay-shadow)" />
        </mask>
      </defs>
      <g transform={ROCKET_TILT}>
        <g ref={shipRef} data-rocket-ship>
          <g mask={`url(#${maskId}-fins)`}>
            {ROCKET_FIN_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <path d={ROCKET_HULL_PATH} mask={`url(#${maskId}-window)`} />
          {ROCKET_FLUTES.map(({ y, endX }) => (
            // The bar runs away from the hull from its round end at `endX`; the dot
            // starts one gap past a bar of zero length and the CSS moves it out.
            <g key={y} data-rocket-flute>
              <line x1={endX - 6} y1={y} x2={-200} y2={y} />
              <circle cx={endX - 24} cy={y} r={6} />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
};
