import { collectUnnotifiedPeople } from "@pcobooster/planning-center-models/scheduling-notifications";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { useProductClient } from "../../app-shell/queries";
import { useNavigationPath } from "../../app-shell/use-navigation-path";
import { useVisibleQuery as useQuery } from "../../app-shell/visible-queries";
import { EmptyState } from "../../components/empty-state";
import { SurfaceColorProvider } from "../../components/surface-card";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import type { RosterAccess } from "./access";
import { NotifyBanner, StaffingStrip, TeamSection } from "./lineup-rows";
import { ReadStatus } from "./read-status";
import { assignHref, planReads } from "./reads";
import type { PlanIds } from "./reads";
import { usePlanWriter } from "./use-plan-writer";

export const PlanLineup = ({
  ids,
  collapsed,
  onToggle,
  onSend,
  canSchedule,
  notice,
}: {
  ids: PlanIds;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSend?: () => void;
  canSchedule: boolean;
  notice: RosterAccess["notice"];
}) => {
  const context = useProductClient();
  const query = useQuery(planReads.groups(context, ids));
  const writer = usePlanWriter(ids);
  const router = useRouter();
  const navigationPath = useNavigationPath();
  const groups = query.data;
  if (groups === undefined) {
    return (
      <View style={{ padding: 16 }}>
        <ReadStatus
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      </View>
    );
  }
  if (groups.length === 0) {
    return (
      <EmptyState
        artwork="plan"
        title="No slots found"
        description="This plan has no team positions yet."
      />
    );
  }
  const people = collectUnnotifiedPeople(groups);
  return (
    <View
      testID="plan-lineup"
      style={{ gap: 12, paddingHorizontal: 16, paddingTop: 4 }}
    >
      {notice === null ? null : (
        <View
          style={{
            padding: 16,
            gap: 4,
            backgroundColor: colors.infoSurface,
            borderRadius: 16,
          }}
        >
          <AppText font="rowTitleEmphasized">{notice.title}</AppText>
          <AppText font="rowDetail" color={colors.inkSecondary}>
            {notice.message}
          </AppText>
        </View>
      )}
      <StaffingStrip groups={groups} />
      {people.length === 0 ? null : (
        <SurfaceColorProvider value="surfaceCard">
          <View
            style={{
              backgroundColor: colors.surfaceCard,
              borderRadius: 26,
              borderCurve: "continuous",
              overflow: "hidden",
            }}
          >
            <NotifyBanner
              names={people.map((person) => person.name)}
              onSend={onSend}
            />
          </View>
        </SurfaceColorProvider>
      )}
      {groups.map((group) => (
        <TeamSection
          key={group.teamId}
          group={group}
          collapsed={collapsed.has(group.teamId)}
          onToggle={() => {
            onToggle(group.teamId);
          }}
          canSchedule={canSchedule}
          onAdjust={(position, change) => {
            void writer.adjust(position, change);
          }}
          onPerson={(person, position) => {
            router.push({
              pathname: "/lineup-person",
              params: {
                ...ids,
                teamId: position.teamId,
                positionId: position.id,
                personId: person.personId ?? person.id,
              },
            });
          }}
          onOpen={(position) => {
            router.push(
              navigationPath(assignHref(ids, position.teamId, position.id))
            );
          }}
        />
      ))}
    </View>
  );
};
