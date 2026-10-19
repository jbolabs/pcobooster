import { useEffect, useRef } from "react";

import { RocketLoaderMark } from "@/components/rocket-loader-mark";
import { ROCKET_FLUTE_LENGTH } from "@/lib/rocket-geometry";

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_CUBIC = "cubic-bezier(0.32, 0, 0.67, 0)";
/** Anticipation: the rocket sinks and pulls its flames in. */
const CROUCH_MS = 180;
/** It accelerates out along its nose. */
const FLIGHT_MS = 450;
/** The overlay starts fading as the rocket leaves, so the app arrives with it. */
const FADE_DELAY_MS = CROUCH_MS + 260;
const FADE_MS = 300;
/** Once shown, it hovers at least this long, so it never flashes up and straight off. */
const MIN_HOVER_MS = 700;

/**
 * Plays the launch from wherever the hover is, so the handoff never jumps: a crouch, then a
 * single puff that blasts the dots off while the rocket accelerates away and the overlay
 * fades. Resolves when the overlay is gone.
 */
const launch = async (overlay: HTMLElement, ship: SVGGElement) => {
  const flutes = [...ship.querySelectorAll<SVGGElement>("[data-rocket-flute]")];
  const dots = [...ship.querySelectorAll<SVGCircleElement>("circle")];
  const fromX = new DOMMatrix(getComputedStyle(ship).transform).m41;
  const fromLen =
    Number(
      getComputedStyle(flutes[0] ?? ship).getPropertyValue("--rocket-len")
    ) || ROCKET_FLUTE_LENGTH;
  overlay.classList.remove("rocket-hover");

  const total = CROUCH_MS + FLIGHT_MS;
  const crouchEnd = CROUCH_MS / total;
  const timing = { duration: total, fill: "forwards" } as const;

  ship.animate(
    [
      { transform: `translateX(${fromX}px)`, easing: EASE_OUT },
      {
        transform: "translateX(-5px)",
        offset: crouchEnd,
        easing: EASE_IN_CUBIC,
      },
      { transform: "translateX(640px)" },
    ],
    timing
  );
  // The flames pull in for the crouch, then flare long as it lifts off.
  for (const flute of flutes) {
    flute.animate(
      [
        { "--rocket-len": fromLen, easing: EASE_OUT },
        { "--rocket-len": 8, offset: crouchEnd, easing: EASE_OUT },
        { "--rocket-len": 72, offset: (CROUCH_MS + 220) / total },
        { "--rocket-len": 72 },
      ],
      timing
    );
  }
  // The puff: the dots blast backwards and dissolve as it kicks off. Until then each
  // keeps riding the end of its bar.
  for (const dot of dots) {
    dot.animate(
      [
        {
          transform: `translateX(${-fromLen}px)`,
          opacity: 1,
          easing: EASE_OUT,
        },
        {
          transform: "translateX(-8px)",
          opacity: 1,
          offset: crouchEnd,
          easing: EASE_OUT,
        },
        {
          transform: "translateX(-120px) scale(0.4)",
          opacity: 0,
          offset: (CROUCH_MS + 380) / total,
        },
        { transform: "translateX(-120px) scale(0.4)", opacity: 0 },
      ],
      timing
    );
  }
  await overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
    delay: FADE_DELAY_MS,
    duration: FADE_MS,
    easing: EASE_OUT,
    fill: "forwards",
  }).finished;
};

const fadeOut = async (overlay: HTMLElement) => {
  await overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 200,
    easing: "ease",
    fill: "forwards",
  }).finished;
};

/**
 * Covers the app on an account's first visit while it gets ready. The rocket hovers until
 * `ready`, then launches away and the overlay fades to reveal the app; `onLaunched` runs
 * once it is gone. With reduced motion the rocket holds still and the overlay just fades.
 * `onLaunched` must be stable; a new one restarts the wait.
 */
export const LaunchOverlay = ({
  ready,
  onLaunched,
}: {
  readonly ready: boolean;
  readonly onLaunched: () => void;
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const shipRef = useRef<SVGGElement>(null);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    shownAt.current = performance.now();
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    const ship = shipRef.current;
    let cancelled = false;
    let timer: number | undefined;
    const leave = async (from: HTMLElement, rocket: SVGGElement) => {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      await (reduceMotion ? fadeOut(from) : launch(from, rocket));
      if (!cancelled) {
        onLaunched();
      }
    };
    if (ready && overlay !== null && ship !== null) {
      const shownFor =
        performance.now() - (shownAt.current ?? performance.now());
      timer = window.setTimeout(
        () => {
          void leave(overlay, ship);
        },
        Math.max(0, MIN_HOVER_MS - shownFor)
      );
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, onLaunched]);

  return (
    <div
      ref={overlayRef}
      className="rocket-hover bg-background animate-in fade-in fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 duration-200"
    >
      <RocketLoaderMark
        shipRef={shipRef}
        aria-hidden
        className="text-chart-2 size-28"
      />
      <output className="text-muted-foreground text-sm">
        Getting everything ready…
      </output>
    </div>
  );
};
