import { summarizeCandidateSchedule } from "@pcobooster/planning-center-models/candidate-summary";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import {
  otherPlanAssignments,
  positionFromLabel,
} from "@pcobooster/planning-center-models/plan-assignment-labels";
import { preferenceConflicts } from "@pcobooster/planning-center-models/ranking-reasons";
import type { PersonWithAvailability } from "@pcobooster/planning-center-models/types";
import { CalendarPlus, Loader2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { PlanPersonStatusMenu } from "@/components/schedule/plan-person-status-menu";
import type { PlanPersonStatusValue } from "@/components/schedule/plan-person-status-menu";
import { RecommendationPopover } from "@/components/schedule/popovers/recommendation-popover";
import { ScheduleCandidateAvatar } from "@/components/schedule/schedule-candidate-details";
import type { CandidateStatus } from "@/components/schedule/schedule-candidate-details";
import { ScheduleDayBars } from "@/components/schedule/schedule-day-bars";
import { UnsentNotificationMark } from "@/components/schedule/scheduling-notification-mark";
import { Button } from "@/components/ui/button";
import { Item } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { useSchedulePlanPerson } from "@/hooks/use-schedule-plan-person";
import { ReplayMask } from "@/lib/replay-mask";
import { cn } from "@/lib/utils";

const STATUS_META: Record<CandidateStatus, { label: string }> = {
  confirmed: { label: "Confirmed" },
  scheduled: { label: "On slot" },
  declined: { label: "Declined" },
  blocked: { label: "Blocked" },
  available: { label: "" },
};

const getStatusVariant = (
  isBlocked: boolean,
  isDeclined: boolean,
  isConfirmed: boolean,
  isScheduled: boolean
): CandidateStatus => {
  if (isBlocked) {
    return "blocked";
  }
  if (isDeclined) {
    return "declined";
  }
  if (isConfirmed) {
    return "confirmed";
  }
  if (isScheduled) {
    return "scheduled";
  }
  return "available";
};

const getDisableReason = (
  missingSelection: boolean,
  isBlocked: boolean,
  isDeclined: boolean,
  isScheduled: boolean
): string | undefined => {
  if (missingSelection) {
    return "Select service type, plan, team, and position to schedule";
  }
  if (isBlocked) {
    return "Person is blocked for this date";
  }
  if (isDeclined) {
    return "Person declined this position";
  }
  if (isScheduled) {
    return "Already scheduled for this selected plan and position";
  }
  return undefined;
};

const getCurrentStatus = (
  isConfirmed: boolean,
  isDeclined: boolean
): PlanPersonStatusValue => {
  if (isConfirmed) {
    return "confirmed";
  }
  if (isDeclined) {
    return "declined";
  }
  return "scheduled";
};

const getSlotStatus = (
  isScheduled: boolean,
  isConfirmed: boolean,
  isDeclined: boolean
): PlanPersonStatusValue | null => {
  if (!isScheduled) {
    return null;
  }
  return getCurrentStatus(isConfirmed, isDeclined);
};

const ScheduleCandidateAction = ({
  person,
  serviceTypeId,
  planId,
  teamId,
  positionId,
  isScheduled,
  isConfirmed,
  isDeclined,
  isScheduling,
  canSchedule,
  disableReason,
  notNotified,
  onSchedule,
  onScheduleSuccess,
  onScheduleError,
}: {
  person: PersonWithAvailability;
  serviceTypeId?: string | null;
  planId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  isScheduled: boolean;
  isConfirmed: boolean;
  isDeclined: boolean;
  isScheduling: boolean;
  canSchedule: boolean;
  disableReason?: string;
  notNotified: boolean;
  onSchedule: () => void;
  onScheduleSuccess?: () => void;
  onScheduleError?: (message: string) => void;
}) => (
  <div
    className={cn(
      "flex w-10 shrink-0 items-center justify-end gap-2 sm:w-20",
      isScheduled && "w-auto sm:w-auto"
    )}
  >
    {isScheduled && notNotified ? <UnsentNotificationMark /> : null}
    {isScheduled ? (
      <PlanPersonStatusMenu
        planPersonId={person.scheduledPlanPersonId}
        serviceTypeId={serviceTypeId}
        personId={person.id}
        personName={person.fullName}
        planId={planId}
        teamId={teamId}
        positionId={positionId}
        currentStatus={getCurrentStatus(isConfirmed, isDeclined)}
        onSuccess={onScheduleSuccess}
        onError={onScheduleError}
      />
    ) : (
      <Button
        variant="outline"
        size="sm"
        className="w-full max-sm:size-10"
        aria-label={
          isScheduling ? "Adding person to position" : "Add person to position"
        }
        disabled={!canSchedule || isScheduling}
        onClick={onSchedule}
        title={disableReason}
      >
        {isScheduling ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            <span className="hidden sm:inline">Adding</span>
          </>
        ) : (
          <>
            <CalendarPlus className="size-3.5 opacity-70" />
            <span className="hidden sm:inline">Add</span>
          </>
        )}
      </Button>
    )}
  </div>
);

export interface ScheduleCandidateTileProps {
  person: PersonWithAvailability;
  /** Their assignment here has a prepared, unsent scheduling email. */
  notNotified: boolean;
  serviceTypeId?: string | null;
  planId?: string | null;
  planReferenceDate?: Date | null;
  teamId?: string | null;
  positionId?: string | null;
  teamName?: string | null;
  positionName?: string | null;
  oneOff?: boolean;
  /** History or availability is still loading. */
  scorePending?: boolean;
  /** Show the day bars of their schedule around the plan. */
  showHistory?: boolean;
  onScheduleSuccess?: () => void;
  onScheduleError?: (message: string) => void;
}

/**
 * One muted line under a name: other positions on this plan, Planning Center preferences
 * this plan goes against, then when they last and next serve.
 */
const CandidateFacts = ({
  person,
  planReferenceDate,
  alsoOn,
  onThisPlan,
  pending,
}: {
  person: PersonWithAvailability;
  planReferenceDate: Date | null;
  alsoOn: string[];
  onThisPlan: boolean;
  pending: boolean;
}) => {
  const orgTimeZone = useOrganizationTimeZone();
  if (pending && person.frequency === undefined) {
    return <Skeleton variant="text" className="h-3 w-40" />;
  }
  const parts = [
    ...alsoOn.map((position) => ({
      text: `Also on ${position}`,
      className: "text-status-info",
    })),
    ...preferenceConflicts(person.recommendationReasoning ?? []).map(
      (conflict) => ({ text: conflict, className: "text-status-scheduled" })
    ),
    ...summarizeCandidateSchedule(
      person.frequency,
      planReferenceDate,
      orgTimeZone,
      { onThisPlan }
    ).map((text) => ({ text, className: undefined })),
  ];
  if (parts.length === 0) {
    return null;
  }
  return (
    // Sized by the row, not its text, so a long line truncates instead of widening the list.
    <p className="text-muted-foreground truncate text-xs leading-snug contain-inline-size">
      {parts.map((part, index) => (
        <span key={part.text} className={part.className}>
          {index > 0 ? " · " : null}
          {part.text}
        </span>
      ))}
    </p>
  );
};

const fitTone = (score: number): string => {
  if (score >= 80) {
    return "text-status-confirmed";
  }
  return score >= 50 ? "text-status-scheduled" : "text-status-declined";
};

const fitFill = (score: number): string => {
  if (score >= 80) {
    return "bg-status-confirmed-bright";
  }
  return score >= 50
    ? "bg-status-scheduled-bright"
    : "bg-status-declined-bright";
};

/** The recommendation score, 0 to 100 with the best candidate at 100, with a bar to match. */
const CandidateFit = ({
  score,
  reasoning,
  pending,
}: {
  score: number | undefined;
  reasoning: string[] | undefined;
  pending: boolean;
}) => {
  if (score === undefined) {
    return pending ? <Skeleton variant="text" className="h-5 w-12" /> : null;
  }
  const rounded = Math.round(score);
  const fill: CSSProperties & { "--fit-width": string } = {
    "--fit-width": `${Math.max(rounded, 3)}%`,
  };
  return (
    <RecommendationPopover reasoning={reasoning} percentage={rounded}>
      <Item
        size="row"
        className="w-14 shrink-0 flex-col items-end gap-1 rounded-4xl in-data-[slot=item-list]:rounded-4xl sm:w-20"
        render={
          <button
            type="button"
            aria-label={`${rounded} fit. Why this ranking`}
          />
        }
      >
        <span className="flex items-baseline gap-1">
          <span
            className={cn(
              "text-base leading-none font-semibold tabular-nums",
              fitTone(rounded)
            )}
          >
            {rounded}
          </span>
          <span className="text-muted-foreground text-xs">fit</span>
        </span>
        <span className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <span
            className={cn(
              "block h-full w-(--fit-width) rounded-full",
              fitFill(rounded)
            )}
            style={fill}
          />
        </span>
      </Item>
    </RecommendationPopover>
  );
};

/**
 * The row's day bars, inset to line up under the name. They stay mounted while hidden
 * so the Show history switch can open and close the space behind them.
 */
const CandidateHistory = ({
  show,
  person,
  planReferenceDate,
  pending,
}: {
  show: boolean;
  person: PersonWithAvailability;
  planReferenceDate: Date | null;
  pending: boolean;
}) => (
  <div className="history-collapse" data-open={show} inert={!show}>
    <div>
      <div className="pt-2 sm:pl-12">
        <ScheduleDayBars
          history={person.serviceHistory ?? []}
          planReferenceDate={planReferenceDate}
          pending={pending}
          reveal={show}
        />
      </div>
    </div>
  </div>
);

const ScheduleErrorLine = ({ error }: { error: string | null }) =>
  error === null || error === "" ? null : (
    <p className="text-destructive mt-2 text-xs sm:pl-12">{error}</p>
  );

const ScheduleCandidateIdentity = ({
  fullName,
  isUnavailableForSlot,
  unavailableSlotLabel,
  isBlocked,
  summary,
}: {
  fullName: string;
  isUnavailableForSlot: boolean;
  unavailableSlotLabel: string | null;
  isBlocked: boolean;
  summary: ReactNode;
}) => (
  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
    <div className="flex min-w-0 items-center gap-1">
      <p
        className={cn(
          "text-foreground min-w-0 truncate text-sm leading-tight font-medium sm:text-base",
          isUnavailableForSlot && "text-muted-foreground line-through"
        )}
      >
        <ReplayMask>{fullName}</ReplayMask>
      </p>
      {unavailableSlotLabel === null ? null : (
        <span
          className={cn(
            "shrink-0 text-xs font-semibold tracking-wide uppercase",
            isBlocked ? "text-status-scheduled" : "text-status-declined"
          )}
        >
          {unavailableSlotLabel}
        </span>
      )}
    </div>
    {summary}
  </div>
);

export const ScheduleCandidateTile = ({
  person,
  notNotified,
  serviceTypeId,
  planId,
  planReferenceDate = null,
  teamId,
  positionId,
  teamName,
  positionName,
  oneOff = false,
  scorePending = false,
  showHistory = true,
  onScheduleSuccess,
  onScheduleError,
}: ScheduleCandidateTileProps) => {
  const isConfirmed = person.isConfirmedForSelectedPlanPosition === true;
  const isDeclined = person.isDeclinedForSelectedPlanPosition === true;
  const isBlocked = person.isBlockedForDate === true;
  const fromServerScheduled =
    person.isScheduledForSelectedPlanPosition === true || isConfirmed;

  const missingSelection = [serviceTypeId, planId, teamId, positionId].some(
    (id) => !isNonEmptyString(id)
  );
  const canScheduleForHook =
    !missingSelection && !isBlocked && !isDeclined && !fromServerScheduled;

  const { isScheduling, scheduleSuccess, scheduleError, handleSchedule } =
    useSchedulePlanPerson({
      serviceTypeId,
      planId,
      teamId,
      positionId,
      teamName,
      positionName,
      canSchedule: canScheduleForHook,
      onScheduleSuccess,
      onScheduleError,
      oneOff,
    });

  const isScheduled = fromServerScheduled || scheduleSuccess;

  const selectedPlanAssignments = otherPlanAssignments(
    person.selectedPlanAssignmentLabels ?? [],
    teamName,
    positionName
  );
  const isScheduledElsewhereOnPlan =
    !isDeclined && selectedPlanAssignments.length > 0;

  const statusVariant = getStatusVariant(
    isBlocked,
    isDeclined,
    isConfirmed,
    isScheduled
  );
  const statusMeta = STATUS_META[statusVariant];

  const isUnavailableForSlot = isBlocked || isDeclined;
  const unavailableSlotLabel = isUnavailableForSlot ? statusMeta.label : null;

  const disableReason = getDisableReason(
    missingSelection,
    isBlocked,
    isDeclined,
    isScheduled
  );

  const canSchedule = disableReason === undefined;

  const slotStatus = getSlotStatus(isScheduled, isConfirmed, isDeclined);
  const alsoOn = isScheduledElsewhereOnPlan
    ? selectedPlanAssignments.map(positionFromLabel)
    : [];
  const showFit = !isScheduled && !isBlocked;

  return (
    <article className="group/row hover:bg-muted/30 relative flex flex-col px-4 py-3 sm:py-3.5">
      <div className="flex items-center gap-2.5 sm:gap-4">
        <ScheduleCandidateAvatar
          person={person}
          statusLabel={statusMeta.label}
          slotStatus={slotStatus}
          isBlocked={isBlocked}
          isDeclined={isDeclined}
          isScheduledElsewhereOnPlan={isScheduledElsewhereOnPlan}
          selectedPlanAssignments={selectedPlanAssignments}
        />

        <ScheduleCandidateIdentity
          fullName={person.fullName}
          isUnavailableForSlot={isUnavailableForSlot}
          unavailableSlotLabel={unavailableSlotLabel}
          isBlocked={isBlocked}
          summary={
            <CandidateFacts
              person={person}
              planReferenceDate={planReferenceDate}
              alsoOn={alsoOn}
              onThisPlan={isScheduled || isScheduledElsewhereOnPlan}
              pending={scorePending}
            />
          }
        />

        {showFit ? (
          <CandidateFit
            score={person.recommendationScore}
            reasoning={person.recommendationReasoning}
            pending={scorePending}
          />
        ) : null}

        <ScheduleCandidateAction
          person={person}
          serviceTypeId={serviceTypeId}
          planId={planId}
          teamId={teamId}
          positionId={positionId}
          isScheduled={isScheduled}
          isConfirmed={isConfirmed}
          isDeclined={isDeclined}
          isScheduling={isScheduling}
          canSchedule={canSchedule}
          disableReason={disableReason}
          notNotified={notNotified}
          onSchedule={() => {
            handleSchedule(person);
          }}
          onScheduleSuccess={onScheduleSuccess}
          onScheduleError={onScheduleError}
        />
      </div>

      <CandidateHistory
        show={showHistory}
        person={person}
        planReferenceDate={planReferenceDate}
        pending={scorePending}
      />

      <ScheduleErrorLine error={scheduleError} />
    </article>
  );
};
