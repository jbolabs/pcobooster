import { useHydrated, useLocation, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { createContext, use, useCallback, useMemo, useState } from "react";

import { useAccessReview } from "@/components/access/access-review";
import { GuidedTour } from "@/components/onboarding/guided-tour";
import { LaunchOverlay } from "@/components/onboarding/launch-overlay";
import {
  appTourSteps,
  planTourSteps,
} from "@/components/onboarding/tour-steps";
import { WelcomeDialog } from "@/components/onboarding/welcome-dialog";
import { useSidebar } from "@/components/ui/sidebar";
import { useAccountsQuery } from "@/hooks/use-account-panel";
import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { usePlanRoute } from "@/hooks/use-plan-route";
import { presentationMode } from "@/lib/build-settings";
import {
  DEMO_ONBOARDING_ACCOUNT,
  ONBOARDING_PROGRESS_KEY,
  hasSeenGuide,
  recordGuideSeen,
} from "@/lib/onboarding";

interface OnboardingContextValue {
  /** Opens the welcome guide again, from the account menu. */
  readonly openWelcome: () => void;
  /** Walks through the app on Services, pointing at each part in turn. */
  readonly startAppTour: () => void;
  /** Walks through the open plan's views again; it runs on its own the first time. */
  readonly startPlanTour: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue>({
  openWelcome: () => {
    // Outside the app shell there is no guide to open.
  },
  startAppTour: () => {
    // Outside the app shell there is no tour to start.
  },
  startPlanTour: () => {
    // Outside the app shell there is no tour to start.
  },
});

export const useOnboarding = (): OnboardingContextValue =>
  use(OnboardingContext);

/**
 * Whose progress the guides record, and whether one may open now: never before the page
 * hydrates or during presentation mode (screenshots and projector demos), and not while the
 * access review is still deciding whether to open. `null` until the account is known.
 */
const useGuideAccount = (): {
  account: string;
  demo: boolean;
  /** Access has settled, so whatever the app first loads has arrived. */
  settled: boolean;
  /** A guide may open now. */
  ready: boolean;
} | null => {
  const hydrated = useHydrated();
  const { data: accounts } = useAccountsQuery();
  const { reviewOpen, accessSettled, noServicesAccess } = useAccessReview();
  const demo = accounts?.demo === true;
  const account = demo
    ? DEMO_ONBOARDING_ACCOUNT
    : (accounts?.selectedAccountId ?? null);
  if (!hydrated || presentationMode || account === null) {
    return null;
  }
  return {
    account,
    demo,
    settled: accessSettled,
    ready: accessSettled && !reviewOpen && !noServicesAccess,
  };
};

/**
 * The launch overlay before an account's first welcome. It is decided once, when the
 * account is known: it shows only if the app is still getting ready then, so it never
 * covers an app that has nothing left to load.
 */
type LaunchState = "undecided" | "showing" | "done";

const useFirstVisitLaunch = (
  guideAccount: ReturnType<typeof useGuideAccount>,
  progressRaw: string | null
) => {
  const [launch, setLaunch] = useState<LaunchState>("undecided");
  if (launch === "undecided" && guideAccount !== null) {
    const firstVisit = !hasSeenGuide(
      progressRaw,
      guideAccount.account,
      "welcome"
    );
    setLaunch(firstVisit && !guideAccount.settled ? "showing" : "done");
  }
  const finishLaunch = useCallback(() => {
    setLaunch("done");
  }, []);
  return { launch, finishLaunch };
};

/**
 * First-run guides for the signed-in app. On an account's first visit the launch overlay
 * covers the app while it loads; the welcome opens once per account after that, and after
 * the access review has had its turn, so a new person never gets two dialogs at once. It
 * sits inside the sidebar provider so the tour can open the sidebar it points at.
 */
export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const guideAccount = useGuideAccount();
  const [progressRaw, setProgressRaw] = useBrowserStorage(
    ONBOARDING_PROGRESS_KEY
  );
  const { launch, finishLaunch } = useFirstVisitLaunch(
    guideAccount,
    progressRaw
  );
  // No guide opens until the launch has cleared the screen.
  const guide =
    guideAccount?.ready === true && launch === "done" ? guideAccount : null;
  const [welcomeRequested, setWelcomeRequested] = useState(false);
  const [appTourActive, setAppTourActive] = useState(false);
  const [planTourRequested, setPlanTourRequested] = useState(false);
  const planRoute = usePlanRoute();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { isMobile, setOpen: setSidebarOpen } = useSidebar();

  const account = guide?.account ?? null;
  const prompted =
    account !== null && !hasSeenGuide(progressRaw, account, "welcome");
  const welcomeOpen = welcomeRequested || prompted;
  // The first plan someone opens walks them through its views, once the welcome is done.
  const planTourPrompted =
    account !== null &&
    !welcomeOpen &&
    !appTourActive &&
    !hasSeenGuide(progressRaw, account, "plan-tour");
  const planTourActive =
    planRoute !== null && (planTourRequested || planTourPrompted);

  const handleWelcomeOpenChange = useCallback(
    (open: boolean) => {
      setWelcomeRequested(open);
      if (!open && account !== null) {
        setProgressRaw(recordGuideSeen(progressRaw, account, "welcome"));
      }
    },
    [account, progressRaw, setProgressRaw]
  );

  const openWelcome = useCallback(() => {
    setWelcomeRequested(true);
  }, []);

  const startAppTour = useCallback(() => {
    handleWelcomeOpenChange(false);
    if (!isMobile) {
      setSidebarOpen(true);
    }
    void navigate({ to: "/services" });
    setAppTourActive(true);
  }, [handleWelcomeOpenChange, isMobile, navigate, setSidebarOpen]);

  const finishAppTour = useCallback(() => {
    setAppTourActive(false);
  }, []);

  const startPlanTour = useCallback(() => {
    setPlanTourRequested(true);
  }, []);

  const finishPlanTour = useCallback(() => {
    setPlanTourRequested(false);
    if (account !== null) {
      setProgressRaw(recordGuideSeen(progressRaw, account, "plan-tour"));
    }
  }, [account, progressRaw, setProgressRaw]);

  const value = useMemo(
    () => ({ openWelcome, startAppTour, startPlanTour }),
    [openWelcome, startAppTour, startPlanTour]
  );

  return (
    <OnboardingContext value={value}>
      {children}
      {launch === "showing" ? (
        <LaunchOverlay
          ready={guideAccount?.settled === true}
          onLaunched={finishLaunch}
        />
      ) : null}
      <WelcomeDialog
        open={welcomeOpen}
        onOpenChange={handleWelcomeOpenChange}
        onStartTour={startAppTour}
        demo={guide?.demo === true}
      />
      {/* The tour starts once Services is on screen; its steps point at that page. */}
      {appTourActive && pathname === "/services" ? (
        <GuidedTour steps={appTourSteps} onFinish={finishAppTour} />
      ) : null}
      {planTourActive && !appTourActive ? (
        // Keyed by plan so stepping to another plan mid-tour starts it fresh there.
        <GuidedTour
          key={planRoute.planId}
          steps={planTourSteps}
          onFinish={finishPlanTour}
        />
      ) : null}
    </OnboardingContext>
  );
};
