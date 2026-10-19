import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar04Icon,
  MusicNote03Icon,
  UsersIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import type { PlanView } from "@pcobooster/planning-center-models/plan-overview";
import { StarField } from "@pcobooster/ui/star-field";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { BrandRocketLogo } from "@/components/brand-rocket-logo";
import { HotkeyChord } from "@/components/hotkey-chord";
import { planViewIcons } from "@/components/plan-view-icons";
import { SidebarNavIcon } from "@/components/sidebar-nav-icon";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeatureEnabled } from "@/hooks/use-feature-enabled";
import { useIsMobile } from "@/hooks/use-mobile";
import { SHORTCUTS_PALETTE_HOTKEY } from "@/lib/app-hotkeys";
import { getPlanViewLabel } from "@/lib/app-routes";
import { ROCKET_ANIMATION } from "@/lib/brand-rocket-animation";
import { cn } from "@/lib/utils";

interface Area {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly icon: IconSvgElement;
}

/** In the order people reach for them, not the tab order. */
const planViewGuide: readonly {
  view: PlanView;
  description: string;
}[] = [
  {
    view: "plan",
    description: "The run sheet. Songs, keys, and items, edited in place.",
  },
  {
    view: "assign",
    description: "Fill an open position with who’s available and rested.",
  },
  {
    view: "lineup",
    description: "Every team’s filled and open roles, with responses.",
  },
  {
    view: "times",
    description: "Service and rehearsal times, and who’s in each.",
  },
  {
    view: "practice",
    description:
      "Step through the songs with charts in any key and the rehearsal tracks.",
  },
  {
    view: "overview",
    description: "What’s still missing before the service.",
  },
];

/** How long each plan view stays highlighted before the preview moves on. */
const SHOWCASE_STEP_MS = 2600;

const servicesArea: Area = {
  key: "services",
  title: "Services",
  description:
    "Every upcoming plan, with the ones you’re on pinned at the top. Open one to build its run sheet and schedule its teams.",
  icon: Calendar04Icon,
};

const peopleArea: Area = {
  key: "people",
  title: "People",
  description:
    "Team health: who to check in with, who’s serving a lot, and who is due.",
  icon: UsersIcon,
};

const songsArea: Area = {
  key: "songs",
  title: "Songs",
  description:
    "Your Planning Center library, with a chord chart you can write or import for each song.",
  icon: MusicNote03Icon,
};

const nextPlanView = (current: PlanView): PlanView => {
  const next =
    (planViewGuide.findIndex((entry) => entry.view === current) + 1) %
    planViewGuide.length;
  return planViewGuide[next]?.view ?? current;
};

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The starry header every step shares. The rocket launches when the guide opens and takes off
 * again on each step, so moving through the guide feels like going somewhere.
 */
const WelcomeSky = ({ step }: { step: number }) => {
  const maskId = useId().replaceAll(":", "");
  return (
    <div className="welcome-sky relative isolate flex h-36 shrink-0 items-center justify-center overflow-hidden md:h-40">
      <StarField variant="header" />
      <div className="welcome-float">
        <div
          key={step}
          aria-hidden
          className={cn(
            "size-16 md:size-20",
            step === 0
              ? ROCKET_ANIMATION.takeoff.className
              : ROCKET_ANIMATION.replay.className
          )}
        >
          <BrandRocketLogo maskId={maskId} />
        </div>
      </div>
    </div>
  );
};

/** Sections as quiet rows: the icon sits in the brand color, with no badge or rule around it. */
const AreaRow = ({ area }: { area: Area }) => (
  <li className="flex gap-3">
    <span className="text-chart-2 flex h-lh shrink-0 items-center">
      <SidebarNavIcon icon={area.icon} className="size-5" />
    </span>
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-sm font-medium">{area.title}</p>
      <p className="text-muted-foreground text-sm text-pretty">
        {area.description}
      </p>
    </div>
  </li>
);

/** A row of the miniature: a label on the left, a quiet detail on the right. */
const MockRow = ({
  label,
  detail,
  accent = false,
}: {
  label: string;
  detail: string;
  accent?: boolean;
}) => (
  <li className="flex items-center justify-between gap-3 py-1.5">
    <span className="flex min-w-0 items-center gap-2 truncate">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          accent ? "bg-chart-2" : "bg-foreground/20"
        )}
      />
      {label}
    </span>
    <span className="text-muted-foreground shrink-0 tabular-nums">
      {detail}
    </span>
  </li>
);

/** Fictional rows that sketch what each view shows, never real people or songs. */
const planViewMocks: Record<
  PlanView,
  readonly { label: string; detail: string; accent?: boolean }[]
> = {
  plan: [
    { label: "Morning Light", detail: "G · 5:00", accent: true },
    { label: "Steady Ground", detail: "Eb · 6:00", accent: true },
    { label: "Welcome and announcements", detail: "4:00" },
  ],
  assign: [
    { label: "Sam Rivera", detail: "Available, rested", accent: true },
    { label: "Jordan Lee", detail: "Served last week" },
    { label: "Avery Chen", detail: "Blocked out" },
  ],
  lineup: [
    { label: "Vocals", detail: "3 of 4 filled", accent: true },
    { label: "Band", detail: "4 of 4 filled", accent: true },
    { label: "Production", detail: "1 open" },
  ],
  times: [
    { label: "Rehearsal", detail: "Thu 7:00 PM", accent: true },
    { label: "Service", detail: "Sun 9:00 AM", accent: true },
    { label: "Service", detail: "Sun 11:00 AM", accent: true },
  ],
  overview: [
    { label: "Open positions", detail: "2" },
    { label: "Unanswered requests", detail: "3" },
    { label: "Songs without a key", detail: "None", accent: true },
  ],
  practice: [
    { label: "Morning Light", detail: "G · Capo 2", accent: true },
    { label: "Original mix", detail: "1:24 / 4:10" },
    { label: "Steady Ground", detail: "Eb" },
  ],
};

/**
 * A miniature of the plan's view tabs that steps through each one, so people see the
 * workspace before they open it. Hovering, touching, or focusing it holds the current view;
 * with reduced motion it waits for a click.
 */
const PlanViewShowcase = () => {
  // Phones get a row of icon tabs; wider screens list the views beside their preview.
  const vertical = !useIsMobile();
  const [view, setView] = useState<PlanView>("plan");
  const [held, setHeld] = useState(false);

  useEffect(() => {
    // Held, or reduced motion: the person steps through the views themselves.
    const autoplay = !held && !prefersReducedMotion();
    const timer = autoplay
      ? window.setInterval(() => {
          setView(nextPlanView);
        }, SHOWCASE_STEP_MS)
      : undefined;
    return () => {
      window.clearInterval(timer);
    };
  }, [held]);

  return (
    <Tabs
      orientation={vertical ? "vertical" : "horizontal"}
      value={view}
      onValueChange={(next: PlanView) => {
        setView(next);
      }}
      onPointerEnter={() => {
        setHeld(true);
      }}
      // A finger "leaves" as soon as it lifts; only a hovering pointer lets go on leave, so
      // a tapped view stays put.
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          setHeld(false);
        }
      }}
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={() => {
        setHeld(false);
      }}
    >
      <TabsList className={vertical ? "w-40 shrink-0" : "w-full"}>
        {planViewGuide.map((entry) => (
          <TabsTrigger key={entry.view} value={entry.view}>
            <SidebarNavIcon icon={planViewIcons[entry.view]} />
            {/* Phones show icons only; the line below names the view. */}
            <span className={vertical ? undefined : "sr-only"}>
              {getPlanViewLabel(entry.view)}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
      {planViewGuide.map((entry) => (
        <TabsContent key={entry.view} value={entry.view}>
          <div className="animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col gap-3 duration-300 motion-reduce:animate-none">
            <p className={cn("text-pretty", vertical ? "pt-1" : "text-center")}>
              <span className="font-medium">
                {getPlanViewLabel(entry.view)}.
              </span>{" "}
              <span className="text-muted-foreground">{entry.description}</span>
            </p>
            <ul
              aria-label={`Example ${getPlanViewLabel(entry.view)} view`}
              className="border-border/60 bg-card/60 rounded-2xl border px-4 py-2 text-sm"
            >
              {planViewMocks[entry.view].map((row) => (
                <MockRow
                  key={`${row.label}-${row.detail}`}
                  label={row.label}
                  detail={row.detail}
                  accent={row.accent}
                />
              ))}
            </ul>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
};

const HintRow = ({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) => (
  <li className={cn("flex items-center justify-between gap-4", className)}>
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium">{children}</span>
  </li>
);

const WhereToFindThings = ({ demo }: { demo: boolean }) => (
  <ul className="flex flex-col gap-3 text-sm">
    <HintRow label="Keyboard shortcuts" className="max-md:hidden">
      <HotkeyChord id="welcome-shortcuts" binding={SHORTCUTS_PALETTE_HOTKEY} />
    </HintRow>
    <HintRow label="This guide, any time">Getting started</HintRow>
    {demo ? null : <HintRow label="Questions or ideas">Feedback</HintRow>}
  </ul>
);

const PROMISES = [
  "Runs on the Planning Center you already use",
  "Every change saves straight back",
  "Built for the people planning Sunday",
] as const;

/** What to expect, set as a quiet list under the welcome. */
const Promises = () => (
  <ul className="flex flex-col gap-3 text-sm">
    {PROMISES.map((promise) => (
      <li key={promise} className="flex items-center gap-3">
        <span
          aria-hidden
          className="bg-chart-2 size-1.5 shrink-0 rounded-full"
        />
        {promise}
      </li>
    ))}
  </ul>
);

interface WelcomeStep {
  readonly title: string;
  readonly description: string;
  readonly body: ReactNode;
}

const useWelcomeSteps = (demo: boolean): readonly WelcomeStep[] => {
  const peopleEnabled = useFeatureEnabled("people");
  const songsEnabled = useFeatureEnabled("chordCharts");
  const areas: Area[] = [servicesArea];
  if (peopleEnabled) {
    areas.push(peopleArea);
  }
  if (songsEnabled) {
    areas.push(songsArea);
  }

  return [
    {
      title: demo ? "Welcome to the demo" : "Welcome aboard",
      description: demo
        ? "A real church’s Planning Center, with fictional names. Look around freely; nothing you change is saved."
        : "Your services, teams, people, and songs from Planning Center, together in one fast view.",
      body: demo ? null : <Promises />,
    },
    {
      title: "Where everything lives",
      description: "The places you’ll use most.",
      body: (
        <ul className="flex flex-col gap-4">
          {areas.map((area) => (
            <AreaRow key={area.key} area={area} />
          ))}
        </ul>
      ),
    },
    {
      title: "Inside every plan",
      description: "Open any plan and switch between five views.",
      body: <PlanViewShowcase />,
    },
    {
      title: "You’re all set",
      description:
        "Take a quick tour of the app, or jump straight in. You can come back to any of this later.",
      body: <WhereToFindThings demo={demo} />,
    },
  ];
};

const STEP_DOT_KEYS = ["welcome", "places", "plan", "ready"] as const;

/** One dot per step; the current one stretches into a pill. */
const StepDots = ({ current }: { current: number }) => (
  <div aria-hidden className="flex items-center justify-center gap-1.5">
    {STEP_DOT_KEYS.map((key, index) => (
      <span
        key={key}
        className={cn(
          "welcome-dot h-1.5 rounded-full",
          index === current ? "bg-foreground w-5" : "bg-foreground/20 w-1.5"
        )}
      />
    ))}
  </div>
);

/**
 * The first thing a new account sees: a short, stepped welcome under a starry header that
 * explains what pcobooster.com is for and where each part of it lives. It opens once per
 * account and again from the account menu.
 */
export const WelcomeDialog = ({
  open,
  onOpenChange,
  onStartTour,
  demo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartTour: () => void;
  demo: boolean;
}) => {
  const steps = useWelcomeSteps(demo);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const current = steps[step] ?? steps[0];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  const go = (delta: 1 | -1) => {
    setDirection(delta === 1 ? "forward" : "back");
    setStep((value) => Math.min(Math.max(value + delta, 0), steps.length - 1));
    // Keyboard users keep their place: the next step's main action takes focus once it renders.
    requestAnimationFrame(() => {
      nextButtonRef.current?.focus({ preventScroll: true });
    });
  };

  const close = () => {
    onOpenChange(false);
    setStep(0);
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
        } else {
          close();
        }
      }}
    >
      <ResponsiveDialogContent
        layout="flush"
        initialFocus={nextButtonRef}
        desktopClassName="sm:max-w-xl"
      >
        <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
          <WelcomeSky step={step} />
          <div
            key={step}
            className={cn(
              "flex flex-col gap-5 px-4 pt-6 md:min-h-80 md:px-6",
              direction === "forward"
                ? "welcome-step-forward"
                : "welcome-step-back"
            )}
          >
            <div className="flex flex-col gap-2 text-center">
              <ResponsiveDialogTitle variant="hero">
                {current.title}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {current.description}
              </ResponsiveDialogDescription>
            </div>
            {current.body}
          </div>
          <div className="pt-6 pb-4">
            <StepDots current={step} />
            <span className="sr-only" aria-live="polite">
              Step {step + 1} of {steps.length}
            </span>
          </div>
          <ResponsiveDialogFooter className="md:mx-6 md:mb-6">
            {isFirst ? null : (
              <Button
                variant="outline"
                className="max-md:order-last max-md:h-11"
                onClick={() => {
                  go(-1);
                }}
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  strokeWidth={2}
                  data-icon="inline-start"
                  aria-hidden
                />
                Back
              </Button>
            )}
            {isLast ? (
              <>
                <Button
                  variant="outline"
                  className="max-md:order-last max-md:h-11"
                  onClick={close}
                >
                  Start exploring
                </Button>
                <Button
                  ref={nextButtonRef}
                  className="max-md:h-11"
                  onClick={() => {
                    setStep(0);
                    onStartTour();
                  }}
                >
                  Show me around
                </Button>
              </>
            ) : (
              <Button
                ref={nextButtonRef}
                className="max-md:h-11"
                onClick={() => {
                  go(1);
                }}
              >
                {isFirst ? "Get started" : "Next"}
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  data-icon="inline-end"
                  aria-hidden
                />
              </Button>
            )}
          </ResponsiveDialogFooter>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
