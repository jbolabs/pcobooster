import {
  Clock01Icon,
  DashboardSquare01Icon,
  HeadphonesIcon,
  Layout3ColumnIcon,
  ListMusicIcon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { PlanView } from "@pcobooster/planning-center-models/plan-overview";

export const planViewIcons: Record<PlanView, IconSvgElement> = {
  overview: DashboardSquare01Icon,
  assign: UserAdd01Icon,
  lineup: Layout3ColumnIcon,
  plan: ListMusicIcon,
  times: Clock01Icon,
  practice: HeadphonesIcon,
};
