import { Host, Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { controlSize, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { useRouter } from "expo-router";
import { useRef } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { ScrollViewInstance } from "react-native";

import { EmptyState } from "../../components/empty-state";
import { PillButton } from "../../components/pill-button";
import { colors } from "../../design/colors";
import { PlanLineup } from "./lineup";
import { PlanOverview } from "./overview";
import { PlanToolbar } from "./plan-toolbar";
import { ReadStatus } from "./read-status";
import { segments } from "./reads";
import type { PlanSegment } from "./reads";
import { PlanRunSheet } from "./runsheet/run-sheet";
import { PlanTimes } from "./times/plan-times";
import { usePlanShell } from "./use-plan-shell";

type PlanShell = ReturnType<typeof usePlanShell>;
const PlanContent = ({
  shell,
  onSegment,
}: {
  shell: PlanShell;
  onSegment: (segment: PlanSegment) => void;
}) => {
  const router = useRouter();
  const { plan, segment } = shell;
  if (plan.data === null) {
    return (
      <EmptyState
        artwork="plan"
        title="Plan unavailable"
        description="This plan could not be loaded. Choose a plan from Services."
        actions={
          <PillButton
            title="Go to Services"
            onPress={() => {
              router.dismissTo("/services");
            }}
          />
        }
      />
    );
  }
  if (plan.data === undefined) {
    return (
      <View style={{ padding: 16 }}>
        <ReadStatus
          error={plan.error}
          retry={() => {
            void plan.refetch();
          }}
        />
      </View>
    );
  }
  if (segment === "Overview") {
    return (
      <PlanOverview
        ids={shell.ids}
        onSegment={onSegment}
        onSend={shell.handleSend}
      />
    );
  }
  if (segment === "Lineup") {
    return (
      <PlanLineup
        ids={shell.ids}
        collapsed={shell.collapsed}
        onToggle={shell.handleToggle}
        onSend={shell.handleSend}
        canSchedule={shell.canSchedule}
        notice={shell.notice}
      />
    );
  }
  return null;
};

export const PlanScreen = () => {
  const shell = usePlanShell();
  const scroll = useRef<ScrollViewInstance>(null);
  const inset = useRef(0);
  const offsets = useRef<Partial<Record<PlanSegment, number>>>({});
  const onSegment = (next: PlanSegment) => {
    shell.handleSegment(next);
    scroll.current?.scrollTo({
      y: (offsets.current[next] ?? 0) - inset.current,
      animated: false,
    });
  };
  if (
    (shell.segment === "Plan" || shell.segment === "Times") &&
    shell.plan.data !== undefined &&
    shell.plan.data !== null
  ) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.surfaceCanvas,
        }}
      >
        {shell.segment === "Plan" ? null : (
          <PlanToolbar
            header={shell.header}
            segment={shell.segment}
            onTitleMenu={shell.handleTitleMenu}
            onStep={shell.handleStep}
            onCollapse={shell.handleCollapse}
            onExpand={shell.handleExpand}
            onOpenPlanningCenter={shell.handleSend}
          />
        )}
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Host matchContents={{ vertical: true }} style={{ width: "100%" }}>
            <Picker
              selection={shell.segment}
              onSelectionChange={(value: PlanSegment) => {
                shell.handleSegment(value);
              }}
              modifiers={[pickerStyle("segmented"), controlSize("large")]}
            >
              {segments.map((name) => (
                <SwiftText key={name} modifiers={[tag(name)]}>
                  {name}
                </SwiftText>
              ))}
            </Picker>
          </Host>
        </View>
        {shell.segment === "Plan" ? (
          <PlanRunSheet
            ids={shell.ids}
            toolbar={{
              header: shell.header,
              segment: shell.segment,
              onTitleMenu: shell.handleTitleMenu,
              onStep: shell.handleStep,
              onCollapse: shell.handleCollapse,
              onExpand: shell.handleExpand,
              onOpenPlanningCenter: shell.handleSend,
            }}
          />
        ) : (
          <PlanTimes ids={shell.ids} />
        )}
      </View>
    );
  }
  return (
    <>
      <PlanToolbar
        header={shell.header}
        segment={shell.segment}
        onTitleMenu={shell.handleTitleMenu}
        onStep={shell.handleStep}
        onCollapse={shell.handleCollapse}
        onExpand={shell.handleExpand}
        onOpenPlanningCenter={shell.handleSend}
      />
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        stickyHeaderIndices={[0]}
        style={{ backgroundColor: colors.surfaceCanvas }}
        contentContainerStyle={{ paddingBottom: 32 }}
        onScroll={(event) => {
          inset.current = event.nativeEvent.contentInset.top;
          offsets.current[shell.segment] =
            event.nativeEvent.contentOffset.y + inset.current;
        }}
        refreshControl={
          <RefreshControl
            refreshing={shell.refreshing}
            onRefresh={shell.handleRefresh}
            tintColor={colors.inkSecondary}
          />
        }
        scrollEventThrottle={100}
      >
        <View
          style={{
            paddingBottom: 8,
            paddingHorizontal: 16,
            backgroundColor: colors.surfaceCanvas,
          }}
        >
          <Host matchContents={{ vertical: true }} style={{ width: "100%" }}>
            <Picker
              selection={shell.segment}
              onSelectionChange={(value: PlanSegment) => {
                onSegment(value);
              }}
              modifiers={[pickerStyle("segmented"), controlSize("large")]}
            >
              {segments.map((name) => (
                <SwiftText key={name} modifiers={[tag(name)]}>
                  {name}
                </SwiftText>
              ))}
            </Picker>
          </Host>
        </View>
        <PlanContent shell={shell} onSegment={onSegment} />
      </ScrollView>
    </>
  );
};
