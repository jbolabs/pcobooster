import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { groupPlansByMonthAndDay } from "@pcobooster/planning-center-models/service-plans";
import type { ServicePlanRow } from "@pcobooster/planning-center-models/service-plans";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { accountHeaderItem } from "../../app-shell/account-button";
import { EmptyState } from "../../components/empty-state";
import { InfoBanner } from "../../components/info-banner";
import { PillButton } from "../../components/pill-button";
import { ProgressCapsule } from "../../components/progress-capsule";
import { SectionHeader } from "../../components/section-header";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { useClock, useOrgTimeZone } from "../../lib/environment";
import { DEFAULT_WINDOW, myRows, visibleRows } from "./agenda";
import {
  AgendaFilterSummary,
  AgendaWindowFooter,
} from "./agenda-filter-summary";
import { AgendaMonthCard, AgendaMonthHeading } from "./agenda-month-section";
import { MyServicesSection } from "./my-services-section";
import { ServicesAgendaSkeleton } from "./services-agenda-skeleton";
import { servicesFilterItem } from "./services-filter-menu";
import { useServicesAgenda } from "./use-services-agenda";
import type { ServicesAgenda } from "./use-services-agenda";

const styles = StyleSheet.create({
  banners: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  content: { paddingBottom: Spacing.xxxl },
  empty: { paddingTop: Spacing.huge },
  loadingMore: {
    left: Spacing.lg,
    position: "absolute",
    right: Spacing.lg,
    top: 0,
  },
  myServices: { paddingTop: Spacing.sm },
  scroll: { backgroundColor: colors.surfaceCanvas },
});

/** The empty state when the window and search leave nothing. */
const EmptyResults = ({ agenda }: { agenda: ServicesAgenda }) => {
  const isSearching = agenda.searchText.trim() !== "";
  if (agenda.window === "recent" && !isSearching) {
    return (
      <EmptyState
        actions={
          <PillButton
            kind="secondary"
            onPress={() => {
              agenda.setWindow(DEFAULT_WINDOW);
            }}
            title="Show upcoming plans"
          />
        }
        artwork="recentlyPlayed"
        description="Past plans of the selected service types appear here."
        title="No recent plans"
      />
    );
  }
  return (
    <EmptyState
      actions={
        agenda.hasActiveFilters || isSearching ? (
          <PillButton
            kind="secondary"
            onPress={() => {
              agenda.resetFilters();
            }}
            title="Reset filters"
          />
        ) : undefined
      }
      artwork="search"
      description="Adjust the search, service type, or date window."
      title="No matching plans"
    />
  );
};

/** What stands in for the agenda when there is nothing to list yet, or null to list it. */
const agendaPlaceholder = (
  agenda: ServicesAgenda,
  rows: readonly ServicePlanRow[]
): ReactNode => {
  const { serviceTypes } = agenda;
  if (!serviceTypes.isLoaded && serviceTypes.errorMessage !== null) {
    return (
      <EmptyState
        actions={
          <PillButton
            kind="secondary"
            onPress={() => {
              serviceTypes.retry();
            }}
            title="Try again"
          />
        }
        artwork="alert"
        description={serviceTypes.errorMessage}
        title="Couldn't load service types"
      />
    );
  }
  if (!agenda.isLoaded || (agenda.isLoadingRecent && rows.length === 0)) {
    return <ServicesAgendaSkeleton />;
  }
  if (serviceTypes.all.length === 0) {
    return (
      <EmptyState
        artwork="services"
        description="Service types you can see in Planning Center appear here."
        title="No service types"
      />
    );
  }
  if (agenda.selectedIds.size === 0) {
    return (
      <EmptyState
        actions={
          <PillButton
            kind="secondary"
            onPress={() => {
              agenda.selectAllServiceTypes();
            }}
            title="Show all service types"
          />
        }
        artwork="services"
        description="Choose which service types the agenda shows."
        title="No service types selected"
      />
    );
  }
  return rows.length === 0 ? <EmptyResults agenda={agenda} /> : null;
};

/**
 * The Services tab root (Swift `ServicesHomeView`, the web's `/services`): "Your services" leads
 * with the plans the person is scheduled on; below, plans grouped by organization month and day
 * under pinned month headings. Search matches service types, titles, series, and dates; the
 * filter picks the window and the service types. Pull to refresh.
 */
export const ServicesHome = () => {
  const agenda = useServicesAgenda();
  const router = useRouter();
  const timeZone = useOrgTimeZone();
  const now = useClock().now();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const rows = visibleRows({
    upcoming: agenda.upcomingRows,
    recent: agenda.recentRows,
    window: agenda.window,
    searchText: agenda.searchText,
    timeZone,
    now,
  });
  const open = (row: ServicePlanRow) => {
    router.push(`/services/${row.serviceTypeId}/plans/${row.planId}`);
  };

  const showsMyServices =
    agenda.window !== "recent" &&
    agenda.searchText.trim() === "" &&
    agenda.serviceTypes.isLoaded;
  const placeholder = agendaPlaceholder(agenda, rows);

  // Children of the scroll view; month headings pin as in the Swift agenda.
  const children: ReactNode[] = [];
  const stickyIndices: number[] = [];
  if (agenda.failures.length > 0 && agenda.serviceTypes.isLoaded) {
    children.push(
      <View key="failures" style={styles.banners}>
        {agenda.failures.map((failure) => (
          <InfoBanner
            action={
              <PillButton
                kind="outline"
                onPress={() => {
                  failure.retry();
                }}
                size="small"
                title="Retry"
              />
            }
            key={failure.id}
            message={failure.title}
            tone="destructive"
          />
        ))}
      </View>
    );
  }
  if (agenda.hasActiveFilters && agenda.serviceTypes.isLoaded) {
    children.push(<AgendaFilterSummary agenda={agenda} key="summary" />);
  }
  if (showsMyServices) {
    children.push(
      <View key="mine" style={styles.myServices}>
        <MyServicesSection
          isLoading={!agenda.isLoaded}
          onOpen={open}
          rows={myRows({
            upcoming: agenda.upcomingRows,
            window: agenda.window,
            myPlanIds: agenda.myPlanIds,
            timeZone,
            now,
          })}
        />
      </View>
    );
  }
  if (placeholder === null) {
    children.push(
      <View key="all-plans" style={styles.banners}>
        <SectionHeader
          title={
            agenda.hasActiveFilters || agenda.searchText.trim() !== ""
              ? "Matching plans"
              : "All plans"
          }
        />
      </View>
    );
    const todayKey = formatCalendarDayInTimeZone(now, timeZone);
    for (const month of groupPlansByMonthAndDay(rows, timeZone)) {
      stickyIndices.push(children.length);
      children.push(
        <AgendaMonthHeading
          key={`heading-${month.heading}`}
          title={month.heading}
        />,
        <AgendaMonthCard
          key={`month-${month.heading}`}
          month={month}
          myPlanIds={agenda.myPlanIds}
          onOpen={open}
          todayKey={todayKey}
        />
      );
    }
    children.push(<AgendaWindowFooter agenda={agenda} key="footer" />);
  } else {
    children.push(
      <View key="placeholder" style={agenda.isLoaded ? styles.empty : null}>
        {placeholder}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "Search plans, series, or dates",
            hideWhenScrolling: true,
            onChangeText: (event) => {
              agenda.setSearchText(event.nativeEvent.text);
            },
            onCancelButtonPress: () => {
              agenda.setSearchText("");
            },
          },
          unstable_headerRightItems: () => [
            accountHeaderItem(),
            servicesFilterItem(agenda),
          ],
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setIsRefreshing(true);
              void (async () => {
                await agenda.refresh();
                setIsRefreshing(false);
              })();
            }}
            refreshing={isRefreshing}
          />
        }
        stickyHeaderIndices={stickyIndices}
        style={styles.scroll}
        testID="services-agenda"
      >
        {children}
      </ScrollView>
      {agenda.isLoadingMore ? (
        <View pointerEvents="none" style={styles.loadingMore}>
          <ProgressCapsule label="Loading plans" thickness={3} value={null} />
        </View>
      ) : null}
    </>
  );
};
