import { describeSchedulingNotification } from "@pcobooster/planning-center-models/scheduling-notifications";
import type { PlanPersonNotification } from "@pcobooster/planning-center-models/types";
import { Mail } from "lucide-react";

import { HoverLabel } from "@/components/ui/hover-card";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { cn } from "@/lib/utils";

const NOT_NOTIFIED_LABEL = "Not notified yet";
/** Planning Center has no public API to send the scheduling email, so it's sent there. */
const SEND_IN_PLANNING_CENTER_HINT = "Send the email in Planning Center";

/**
 * Planning Center marks an unsent scheduling email with an envelope beside the person, so we
 * use the same one.
 */
export const UnsentNotificationMark = ({
  className,
}: {
  className?: string;
}) => (
  <HoverLabel
    label={`${NOT_NOTIFIED_LABEL}. ${SEND_IN_PLANNING_CENTER_HINT}.`}
    trigger={
      <span
        className={cn(
          "text-muted-foreground inline-flex shrink-0 items-center",
          className
        )}
      />
    }
  >
    <Mail className="size-3.5" aria-hidden />
    <span className="sr-only">{NOT_NOTIFIED_LABEL}</span>
  </HoverLabel>
);

export const SchedulingNotificationNote = ({
  notification,
  className,
}: {
  notification: PlanPersonNotification | null;
  className?: string;
}) => {
  const orgTimeZone = useOrganizationTimeZone();
  const description = describeSchedulingNotification(notification, orgTimeZone);
  if (description === null) {
    return null;
  }
  return (
    <p
      className={cn(
        "text-muted-foreground flex items-start gap-2 text-xs",
        className
      )}
    >
      <span aria-hidden className="flex h-lh shrink-0 items-center">
        <Mail className="size-3.5" />
      </span>
      <span>{description}</span>
    </p>
  );
};
