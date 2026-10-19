import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  MinusSignCircleIcon,
} from "@hugeicons/core-free-icons";
import type {
  FeatureAccess,
  FeatureAvailability,
} from "@pcobooster/planning-center-models/access";
import { hasRestrictedAccess } from "@pcobooster/planning-center-models/access";
import type { ReactNode } from "react";
import { createContext, use, useCallback, useMemo, useState } from "react";

import { SidebarNavIcon } from "@/components/sidebar-nav-icon";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { usePlanningCenterAccess } from "@/hooks/use-planning-center-access";
import type { PlanningCenterAccessState } from "@/hooks/use-planning-center-access";
import {
  ACCESS_REVIEW_DISMISSALS_KEY,
  accessFingerprint,
  recordAccessReviewDismissal,
  shouldPromptAccessReview,
} from "@/lib/planning-center-access";
import { cn } from "@/lib/utils";

interface AccessReviewContextValue {
  readonly openReview: () => void;
  /** Whether anything is less than fully available; false until access is known. */
  readonly restricted: boolean;
  /** Whether the person's account can't open Services at all. */
  readonly noServicesAccess: boolean;
  readonly demo: boolean;
  /** Whether the review is open, so other first-run prompts wait their turn. */
  readonly reviewOpen: boolean;
  /** Whether Planning Center answered (or failed), so the review won't still pop up. */
  readonly accessSettled: boolean;
}

const AccessReviewContext = createContext<AccessReviewContextValue>({
  openReview: () => {
    // Outside the app shell there is no review to open.
  },
  restricted: false,
  noServicesAccess: false,
  demo: false,
  reviewOpen: false,
  accessSettled: false,
});

/** Opens the access review and reports whether the person's access is limited. */
export const useAccessReview = (): AccessReviewContextValue =>
  use(AccessReviewContext);

const availabilityIcon: Record<FeatureAvailability, typeof CancelCircleIcon> = {
  full: CheckmarkCircle02Icon,
  limited: MinusSignCircleIcon,
  none: CancelCircleIcon,
};

const availabilityClassName: Record<FeatureAvailability, string> = {
  full: "text-status-confirmed",
  limited: "text-status-scheduled",
  none: "text-muted-foreground",
};

const availabilityLabel: Record<FeatureAvailability, string> = {
  full: "Available",
  limited: "Limited",
  none: "Not available",
};

const FeatureAccessRow = ({ entry }: { entry: FeatureAccess }) => (
  <li className="flex gap-3 py-2.5">
    <span aria-hidden className="flex h-lh shrink-0 items-center text-sm">
      <SidebarNavIcon
        icon={availabilityIcon[entry.availability]}
        className={availabilityClassName[entry.availability]}
      />
    </span>
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-medium">
        <span>{entry.label}</span>
        <span
          className={cn(
            "text-xs font-normal",
            availabilityClassName[entry.availability]
          )}
        >
          {availabilityLabel[entry.availability]}
        </span>
      </p>
      {entry.detail === "" ? null : (
        <p className="text-muted-foreground mt-0.5 text-sm">{entry.detail}</p>
      )}
      {entry.ask === null || entry.availability === "full" ? null : (
        <p className="text-muted-foreground mt-1 text-xs">
          Ask a Planning Center admin for{" "}
          <span className="text-foreground font-medium">{entry.ask}</span>.
        </p>
      )}
    </div>
  </li>
);

const AccessReviewDialog = ({
  open,
  onOpenChange,
  features,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  features: readonly FeatureAccess[];
  status: PlanningCenterAccessState["status"];
}) => {
  const restricted = hasRestrictedAccess(features);
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            Your Planning Center access
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {restricted
              ? "pcobooster.com can only do what your Planning Center permissions allow. Some of it won't work for you yet."
              : "Your Planning Center permissions let you use everything here."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {/* Phone sheets have no padding of their own; the header and footer bring theirs. */}
        <div className="flex flex-col gap-4 max-md:overflow-y-auto max-md:overscroll-contain max-md:px-4">
          {status === "ready" ? null : (
            <p className="text-muted-foreground text-sm">
              {status === "error"
                ? "Planning Center didn’t answer, so your permissions couldn’t be checked. Try again in a moment."
                : "Checking your permissions…"}
            </p>
          )}
          {status === "ready" ? (
            <ul className="divide-border/60 -my-1 divide-y">
              {features.map((entry) => (
                <FeatureAccessRow key={entry.feature} entry={entry} />
              ))}
            </ul>
          ) : null}
          {restricted ? (
            <p className="text-muted-foreground text-xs">
              Permissions are set in Planning Center, in each person’s Services
              and People settings. Changes show up here within a few minutes.
            </p>
          ) : null}
        </div>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose render={<Button />}>
            Got it
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};

/**
 * Reads the person's Planning Center access for the whole signed-in app. When it limits
 * something this deployment offers, the review opens once per account (and again if the
 * access changes), so people learn what won't work before they run into it.
 */
export const AccessReviewProvider = ({ children }: { children: ReactNode }) => {
  const { snapshot, status, features, accountId, demo } =
    usePlanningCenterAccess();
  const [dismissalsRaw, setDismissalsRaw] = useBrowserStorage(
    ACCESS_REVIEW_DISMISSALS_KEY
  );
  const [reviewRequested, setReviewRequested] = useState(false);
  const noServicesAccess = snapshot?.services.status === "none";
  // Closing the review records a dismissal, which ends the prompt for this access.
  const prompted =
    !demo &&
    accountId !== null &&
    !noServicesAccess &&
    shouldPromptAccessReview({ features, accountId, dismissalsRaw });
  const open = reviewRequested || prompted;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setReviewRequested(nextOpen);
      if (!nextOpen && accountId !== null && features.length > 0) {
        setDismissalsRaw(
          recordAccessReviewDismissal(
            dismissalsRaw,
            accountId,
            accessFingerprint(features)
          )
        );
      }
    },
    [accountId, dismissalsRaw, features, setDismissalsRaw]
  );

  const openReview = useCallback(() => {
    setReviewRequested(true);
  }, []);

  const value = useMemo(
    () => ({
      openReview,
      restricted: hasRestrictedAccess(features),
      noServicesAccess,
      demo,
      reviewOpen: open,
      accessSettled: status !== "loading",
    }),
    [demo, features, noServicesAccess, open, openReview, status]
  );

  return (
    <AccessReviewContext value={value}>
      {children}
      <AccessReviewDialog
        open={open}
        onOpenChange={handleOpenChange}
        features={features}
        status={status}
      />
    </AccessReviewContext>
  );
};
