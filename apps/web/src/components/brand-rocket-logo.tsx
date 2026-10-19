import {
  ROCKET_FIN_PATHS,
  ROCKET_HULL_PATH,
  ROCKET_TILT,
  ROCKET_VIEW_BOX,
  ROCKET_WINDOW,
} from "@/lib/rocket-geometry";

export const BrandRocketLogo = ({ maskId }: { maskId: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={ROCKET_VIEW_BOX}
    fill="none"
    aria-hidden
    className="text-chart-2 size-full overflow-visible"
  >
    <defs>
      <mask
        id={`${maskId}-fin-clearance`}
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
        id={`${maskId}-rocket-window`}
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
    <g className="sidebar-brand-rocket-flight">
      <g transform={ROCKET_TILT} fill="currentColor">
        <g mask={`url(#${maskId}-fin-clearance)`}>
          {ROCKET_FIN_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <path d={ROCKET_HULL_PATH} mask={`url(#${maskId}-rocket-window)`} />
        <g className="sidebar-brand-rocket-exhaust">
          <rect x="71" y="104" width="33" height="12" rx="6" />
          <rect x="65" y="122" width="33" height="12" rx="6" />
          <rect x="71" y="140" width="33" height="12" rx="6" />
          <circle cx="59" cy="110" r="6" />
          <circle cx="53" cy="128" r="6" />
          <circle cx="59" cy="146" r="6" />
        </g>
      </g>
    </g>
  </svg>
);
