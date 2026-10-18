import {
  buildReadinessChecks,
  summarizeOrder,
  summarizeStaffing,
  summarizeTimes,
} from "@pcobooster/planning-center-models/plan-overview";
import type { PlanView } from "@pcobooster/planning-center-models/plan-overview";
import { collectUnnotifiedPeople } from "@pcobooster/planning-center-models/scheduling-notifications";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { useProductClient } from "../../app-shell/queries";
import { useVisibleQuery as useQuery } from "../../app-shell/visible-queries";
import { SongsCard, TimesCard } from "./order-cards";
import { PeopleCard } from "./people-card";
import { ReadinessCard } from "./readiness-card";
import { assignHref, planReads } from "./reads";
import type { PlanIds, PlanSegment } from "./reads";

const checkSegments = {
  overview: "Overview",
  lineup: "Lineup",
  assign: "Lineup",
  plan: "Plan",
  times: "Times",
  // Phones have no Practice segment yet; its songs live under Plan.
  practice: "Plan",
} as const satisfies Record<PlanView, PlanSegment>;

export const PlanOverview = ({
  ids,
  onSegment,
  onSend,
}: {
  ids: PlanIds;
  onSegment: (segment: PlanSegment) => void;
  onSend?: () => void;
}) => {
  const context = useProductClient();
  const router = useRouter();
  const groups = useQuery(planReads.groups(context, ids));
  const items = useQuery(planReads.items(context, ids));
  const times = useQuery(planReads.times(context, ids));
  const staffing =
    groups.data === undefined ? null : summarizeStaffing(groups.data);
  const order = items.data === undefined ? null : summarizeOrder(items.data);
  const schedule = times.data === undefined ? null : summarizeTimes(times.data);
  const checks = buildReadinessChecks({ staffing, order, schedule });
  const unnotified = collectUnnotifiedPeople(groups.data ?? []);
  return (
    <View
      style={{ gap: 16, paddingHorizontal: 16, paddingTop: 8 }}
      testID="plan-overview"
    >
      <ReadinessCard
        checks={checks}
        loading={groups.isPending || items.isPending || times.isPending}
        incomplete={groups.isError || items.isError || times.isError}
        opensPlanningCenter={onSend !== undefined}
        onSelect={(check) => {
          if (check.id === "notifications" && onSend !== undefined) {
            onSend();
            return;
          }
          if (check.view === "assign") {
            router.push(assignHref(ids));
            return;
          }
          onSegment(checkSegments[check.view]);
        }}
      />
      <PeopleCard
        staffing={staffing}
        unnotified={unnotified}
        error={groups.error}
        retry={() => {
          void groups.refetch();
        }}
        onLineup={() => {
          onSegment("Lineup");
        }}
        onAssign={(teamId, positionId) => {
          router.push(assignHref(ids, teamId, positionId));
        }}
        onSend={onSend}
      />
      <SongsCard
        order={order}
        error={items.error}
        retry={() => {
          void items.refetch();
        }}
        onOpen={() => {
          onSegment("Plan");
        }}
      />
      <TimesCard
        schedule={schedule}
        error={times.error}
        retry={() => {
          void times.refetch();
        }}
        onOpen={() => {
          onSegment("Times");
        }}
      />
    </View>
  );
};
