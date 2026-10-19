import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Flame,
  MailQuestionMark,
  MoonStar,
  ThumbsDown,
  TrendingDown,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { HoverLabel } from "@/components/ui/hover-card";
import { describePersonSignal } from "@/lib/team-health";
import type { PersonSignal } from "@/lib/team-health";
import { cn } from "@/lib/utils";

type SignalLook =
  | "waiting"
  | "declining"
  | "drifting"
  | "overloaded"
  | "due"
  | "not-serving";

const signalLook = (signal: PersonSignal): SignalLook => {
  if (signal.kind === "due") {
    return signal.daysSinceServed === null ? "not-serving" : "due";
  }
  return signal.kind;
};

const signalIcon: Record<SignalLook, LucideIcon> = {
  waiting: MailQuestionMark,
  declining: ThumbsDown,
  drifting: TrendingDown,
  overloaded: Flame,
  due: CalendarClock,
  "not-serving": MoonStar,
};

/** Status tone per signal: waiting is amber, strain is red, fading is blue. */
const signalTone: Record<SignalLook, string> = {
  waiting: "text-status-scheduled",
  declining: "text-status-declined",
  drifting: "text-status-info",
  overloaded: "text-status-declined",
  due: "text-muted-foreground",
  "not-serving": "text-muted-foreground",
};

/** The icon for a person's signal, tinted by how it reads at a glance. */
export const PersonSignalIcon = ({
  signal,
  className,
}: {
  signal: PersonSignal;
  className?: string;
}) => {
  const look = signalLook(signal);
  const Icon = signalIcon[look];
  return (
    <Icon
      aria-hidden
      data-icon="inline-start"
      className={cn(signalTone[look], className)}
    />
  );
};

/** A signal as a badge; hovering shows the numbers behind it. */
export const PersonSignalBadge = ({ signal }: { signal: PersonSignal }) => {
  const { label, detail } = describePersonSignal(signal);
  return (
    <HoverLabel label={detail} trigger={<Badge variant="outline" />}>
      <PersonSignalIcon signal={signal} />
      {label}
    </HoverLabel>
  );
};

/** Each signal as an icon, a label, and the sentence behind it. */
export const PersonSignalList = ({
  signals,
}: {
  signals: readonly PersonSignal[];
}) => (
  <ul className="flex flex-col gap-3">
    {signals.map((signal) => {
      const { label, detail } = describePersonSignal(signal);
      return (
        <li key={signal.kind} className="flex items-start gap-2.5">
          <span aria-hidden className="flex h-lh shrink-0 items-center text-sm">
            <PersonSignalIcon signal={signal} className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{label}</span>
            <span className="text-muted-foreground block text-sm">
              {detail}
            </span>
          </span>
        </li>
      );
    })}
  </ul>
);
