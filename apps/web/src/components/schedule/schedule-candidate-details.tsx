import { getInitials } from "@pcobooster/planning-center-models/initials";
import type { PersonWithAvailability } from "@pcobooster/planning-center-models/types";

import { AvatarStatus } from "@/components/schedule/avatar-status";
import type { ScheduleStatusDotStatus } from "@/components/schedule/status-dot";
import {
  Avatar,
  AvatarButton,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import { ReplayMask } from "@/lib/replay-mask";

export type CandidateStatus =
  | "confirmed"
  | "scheduled"
  | "declined"
  | "blocked"
  | "available";

export const ScheduleCandidateAvatar = ({
  person,
  statusLabel,
  slotStatus,
  isBlocked,
  isDeclined,
  isScheduledElsewhereOnPlan,
  selectedPlanAssignments,
}: {
  person: PersonWithAvailability;
  statusLabel: string;
  slotStatus?: ScheduleStatusDotStatus | null;
  isBlocked: boolean;
  isDeclined: boolean;
  isScheduledElsewhereOnPlan: boolean;
  selectedPlanAssignments: string[];
}) => {
  const initials = getInitials(person.fullName);
  const avatarInner = (
    <>
      <AvatarImage src={person.photoThumbnailUrl ?? undefined} alt="" />
      <AvatarFallback>{initials}</AvatarFallback>
    </>
  );
  const blockedAvatarTint = isBlocked ? (
    <span
      aria-hidden
      className="bg-destructive/[0.26] dark:bg-destructive/[0.2] pointer-events-none absolute inset-0 z-[1] rounded-full"
    />
  ) : null;

  if (isDeclined && !isBlocked) {
    const trimmedReason = person.selectedPlanDeclineReason?.trim() ?? "";
    const declineReason =
      trimmedReason.length > 0
        ? trimmedReason
        : "No note was saved with this decline in Planning Center.";
    return (
      <ResponsivePopover>
        <ResponsivePopoverTrigger
          render={
            <AvatarButton
              aria-label="Decline reason"
              title="View decline reason"
            />
          }
        >
          <AvatarStatus status={slotStatus}>
            <Avatar aria-hidden>{avatarInner}</Avatar>
          </AvatarStatus>
        </ResponsivePopoverTrigger>
        <ResponsivePopoverContent
          title="Decline reason"
          align="start"
          side="right"
          sideOffset={8}
          className="w-auto max-w-[18rem]"
        >
          <div className="p-3">
            <p className="text-muted-foreground text-xs font-medium">
              Decline reason
            </p>
            <ReplayMask className="text-foreground mt-1.5 block leading-relaxed [overflow-wrap:anywhere]">
              {declineReason}
            </ReplayMask>
          </div>
        </ResponsivePopoverContent>
      </ResponsivePopover>
    );
  }

  if (isScheduledElsewhereOnPlan) {
    const assignmentsLabel = `Also scheduled for: ${selectedPlanAssignments.join(", ")}`;
    return (
      <ResponsivePopover>
        <ResponsivePopoverTrigger
          render={
            <AvatarButton
              aria-label={assignmentsLabel}
              title={assignmentsLabel}
            />
          }
        >
          <AvatarStatus status={slotStatus} alsoScheduled>
            <span className="relative inline-flex shrink-0 overflow-visible">
              <Avatar aria-hidden>{avatarInner}</Avatar>
              {blockedAvatarTint}
            </span>
          </AvatarStatus>
        </ResponsivePopoverTrigger>
        <ResponsivePopoverContent
          title="Also scheduled"
          align="start"
          side="right"
          sideOffset={8}
          className="w-auto max-w-[16rem]"
        >
          <div className="p-3">
            <p className="text-foreground [overflow-wrap:anywhere]">
              <span className="text-foreground/90 font-medium">
                Also scheduled for:
              </span>{" "}
              <span className="text-muted-foreground">
                {selectedPlanAssignments.join(", ")}
              </span>
            </p>
          </div>
        </ResponsivePopoverContent>
      </ResponsivePopover>
    );
  }

  return (
    <AvatarStatus status={slotStatus}>
      <span className="relative inline-flex shrink-0 overflow-visible">
        <Avatar title={statusLabel || undefined}>{avatarInner}</Avatar>
        {blockedAvatarTint}
      </span>
    </AvatarStatus>
  );
};
