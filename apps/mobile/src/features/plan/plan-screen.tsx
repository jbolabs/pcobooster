import { Host, Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { controlSize, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { ScrollViewInstance } from "react-native";

import { EmptyState } from "../../components/empty-state";
import { PillButton } from "../../components/pill-button";
import { colors } from "../../design/colors";
import { PlanFiles } from "./files/plan-files";
import { PlanLineup } from "./lineup";
import { PlanToolbar } from "./plan-toolbar";
import { ReadStatus } from "./read-status";
import { segments, segmentLabels } from "./reads";
import type { PlanSegment } from "./reads";
import { PlanRunSheet } from "./runsheet/run-sheet";
import { PlanTimes } from "./times/plan-times";
import { usePlanShell } from "./use-plan-shell";

const PlanContent = () => {
  const shell = usePlanShell();
  const router = useRouter();
  const scroll = useRef<ScrollViewInstance>(null);
  const offsets = useRef<Partial<Record<PlanSegment, number>>>({});
  const onSegment = (next: PlanSegment) => {
    shell.handleSegment(next);
    scroll.current?.scrollTo({
      y: offsets.current[next] ?? 0,
      animated: false,
    });
  };
  const toolbar = {
    header: shell.header,
    segment: shell.segment,
    onTitleMenu: shell.handleTitleMenu,
    onCollapse: shell.handleCollapse,
    onExpand: shell.handleExpand,
    onOpenPlanningCenter: shell.handleSend,
  };
  const content = () => {
    if (shell.plan.data === undefined) {
      return (
        <View style={{ padding: 16 }}>
          <ReadStatus
            error={shell.plan.error}
            retry={() => {
              void shell.plan.refetch();
            }}
          />
        </View>
      );
    }
    if (shell.plan.data === null) {
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
    if (shell.segment === "Plan") {
      return <PlanRunSheet ids={shell.ids} toolbar={toolbar} />;
    }
    if (shell.segment === "Files") {
      return <PlanFiles ids={shell.ids} />;
    }
    if (shell.segment === "Times") {
      return <PlanTimes ids={shell.ids} />;
    }
    return (
      <ScrollView
        ref={scroll}
        style={{ backgroundColor: colors.surfaceCanvas }}
        contentContainerStyle={{ paddingBottom: 32 }}
        onScroll={(event) => {
          offsets.current[shell.segment] = event.nativeEvent.contentOffset.y;
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
        <PlanLineup
          ids={shell.ids}
          collapsed={shell.collapsed}
          onToggle={shell.handleToggle}
          onSend={shell.handleSend}
          canSchedule={shell.canSchedule}
          notice={shell.notice}
        />
      </ScrollView>
    );
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceCanvas }}>
      {shell.segment === "Plan" &&
      shell.plan.data !== undefined &&
      shell.plan.data !== null ? null : (
        <PlanToolbar {...toolbar} />
      )}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
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
                {segmentLabels[name]}
              </SwiftText>
            ))}
          </Picker>
        </Host>
      </View>
      {content()}
    </View>
  );
};

export const PlanScreen = () => {
  const params = useLocalSearchParams<{
    "service-type-id": string;
    "plan-id": string;
    segment?: string;
  }>();
  return (
    <PlanContent
      key={`${params["service-type-id"]}/${params["plan-id"]}/${params.segment ?? "plan"}`}
    />
  );
};
