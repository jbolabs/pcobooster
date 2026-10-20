import { orgCalendarDaysRefMinusItem } from "@pcobooster/planning-center-models/calendar";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { useNavigationPath } from "../../app-shell/use-navigation-path";
import { EmptyState } from "../../components/empty-state";
import { Hairline } from "../../components/hairline";
import { InfoBanner } from "../../components/info-banner";
import { PersonAvatar } from "../../components/person-avatar";
import { PillButton } from "../../components/pill-button";
import { SectionHeader } from "../../components/section-header";
import { Skeleton, SkeletonRow } from "../../components/skeleton";
import { StatusBadge } from "../../components/status-badge";
import { SurfaceCard } from "../../components/surface-card";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Metrics, Spacing } from "../../design/metrics";
import { useOrgTimeZone } from "../../lib/environment";
import { planHref } from "../plan/reads";
import type { PlanIds } from "../plan/reads";
import { useOpenPlanningCenterPerson } from "../plan/roster-links";
import { SEPARATOR } from "./dashboard";
import { SignalChips } from "./people-row";
import {
  blockedDays,
  commitmentGroups,
  commitmentPlan,
  describeBlockoutDates,
  describeBlockoutLength,
  describeCommitment,
  describeMonth,
  formatMonthDay,
  isAwayNow,
  nextServingPlan,
  parseMonthParam,
  sortBlockouts,
} from "./person-detail";
import { peopleTestIds } from "./routes";
import {
  describeCadence,
  describeDaysAgo,
  describeSignal,
  formatWeekdayDayKey,
} from "./team-health";
import type { PersonDetail, ServingRhythm } from "./types";
import { usePersonDetail } from "./use-person-detail";
import type { PersonDetailModel } from "./use-person-detail";

const DIMMED_OPACITY = 0.55;

const styles = StyleSheet.create({
  card: { marginHorizontal: Spacing.lg },
  cardBody: { gap: Spacing.sm, padding: Spacing.lg },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  cardTitle: { flex: 1, gap: Spacing.xxs },
  content: {
    gap: Spacing.lg,
    paddingBottom: Spacing.xxxl,
    paddingTop: Spacing.sm,
  },
  empty: { paddingTop: Spacing.huge },
  fact: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: Spacing.md,
    justifyContent: "space-between",
    minHeight: Metrics.minimumTapTarget,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  factValue: { alignItems: "flex-end", flexShrink: 1 },
  groupTitle: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  headerText: { flex: 1, gap: Spacing.sm },
  monthButtons: { flexDirection: "row", gap: Spacing.xs },
  pressed: { backgroundColor: colors.surfaceHighlight },
  row: {
    gap: Spacing.xxs,
    minHeight: Metrics.minimumTapTarget,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  rowTitle: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  scroll: { backgroundColor: colors.surfaceCanvas },
});

/** A titled card with an optional trailing accessory. */
const Card = ({
  title,
  subtitle,
  accessory,
  children,
  testID,
}: {
  title: string;
  subtitle?: string;
  accessory?: ReactNode;
  children: ReactNode;
  testID?: string;
}) => (
  <SurfaceCard padding="none" style={styles.card}>
    <View testID={testID}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <SectionHeader title={title} />
          {subtitle === undefined ? null : (
            <AppText color={colors.inkSecondary} font="meta" tabular>
              {subtitle}
            </AppText>
          )}
        </View>
        {accessory}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  </SurfaceCard>
);

/** A label and its value on one line; pressable when it opens something. */
const Fact = ({
  label,
  value,
  detail,
  onPress,
}: {
  label: string;
  value: string;
  detail?: string;
  onPress?: () => void;
}) => {
  const body = (
    <>
      <AppText color={colors.inkSecondary} font="rowDetail">
        {label}
      </AppText>
      <View style={styles.factValue}>
        <AppText color={colors.ink} font="rowDetail" tabular>
          {onPress === undefined ? value : `${value} ›`}
        </AppText>
        {detail === undefined ? null : (
          <AppText color={colors.inkSecondary} font="meta">
            {detail}
          </AppText>
        )}
      </View>
    </>
  );
  const spoken = [label, value, detail]
    .filter((part) => part !== undefined)
    .join(", ");
  return onPress === undefined ? (
    <View accessibilityLabel={spoken} accessible style={styles.fact}>
      {body}
    </View>
  ) : (
    <Pressable
      accessibilityHint="Opens the plan"
      accessibilityLabel={spoken}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.fact, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
};

/** Served looks back, scheduled looks ahead (the web's `ServingNumbers`). */
const ServingNumbers = ({ rhythm }: { rhythm: ServingRhythm }) => (
  <Card title="Serving">
    <Fact label="Served, last 30 days" value={String(rhythm.servedDays30)} />
    <Fact label="Served, last 90 days" value={String(rhythm.servedDays90)} />
    <Fact
      label="Scheduled, next 30 days"
      value={String(rhythm.upcomingDays30)}
    />
    <Fact
      label="Declined, last 6 months"
      value={
        rhythm.requests180 === 0
          ? "No requests"
          : `${rhythm.declined180} of ${rhythm.requests180}`
      }
    />
  </Card>
);

/** When they last served, when they serve next (opening that plan when this month holds it), and how often. */
const Rotation = ({
  detail,
  todayKey,
  onOpenPlan,
}: {
  detail: PersonDetail;
  todayKey: string;
  onOpenPlan: (plan: PlanIds) => void;
}) => {
  const { rhythm, monthDays } = detail.person;
  const next = nextServingPlan(rhythm.nextServingOn, detail.month, monthDays);
  return (
    <Card title="Rotation">
      <Fact
        detail={
          rhythm.lastServedOn === null
            ? undefined
            : describeDaysAgo(
                orgCalendarDaysRefMinusItem(rhythm.lastServedOn, todayKey)
              )
        }
        label="Last served"
        value={
          rhythm.lastServedOn === null
            ? "Not in 6 months"
            : formatWeekdayDayKey(rhythm.lastServedOn)
        }
      />
      <Fact
        label="Next serving"
        onPress={
          next === null
            ? undefined
            : () => {
                onOpenPlan(next);
              }
        }
        value={
          rhythm.nextServingOn === null
            ? "Not scheduled"
            : formatWeekdayDayKey(rhythm.nextServingOn)
        }
      />
      <Fact
        label="Usually serves"
        value={
          rhythm.typicalGapDays === null
            ? "Not enough history"
            : describeCadence(rhythm.typicalGapDays)
        }
      />
    </Card>
  );
};

/** The month's commitments, each opening its plan's Lineup, with blocked-out days and paging. */
const Month = ({
  model,
  detail,
  onOpenPlan,
}: {
  model: PersonDetailModel;
  detail: PersonDetail;
  onOpenPlan: (plan: PlanIds) => void;
}) => {
  const zone = useOrgTimeZone();
  const groups = commitmentGroups(
    detail.person.monthDays,
    detail.month,
    model.todayKey
  );
  const blocked = blockedDays(detail.month, model.blockouts ?? [], zone);
  return (
    <Card
      accessory={
        <View style={styles.monthButtons}>
          <PillButton
            kind="outline"
            onPress={() => {
              model.showPreviousMonth();
            }}
            iconOnly
            size="small"
            symbol="chevronLeft"
            testID={peopleTestIds.monthPrevious}
            title="Previous month"
          />
          <PillButton
            kind="outline"
            onPress={() => {
              model.showNextMonth();
            }}
            iconOnly
            size="small"
            symbol="chevronRight"
            testID={peopleTestIds.monthNext}
            title="Next month"
          />
        </View>
      }
      subtitle={describeMonth(detail.person.monthDays)}
      title={detail.month.label}
    >
      <View
        style={{ opacity: model.isShowingPlaceholder ? DIMMED_OPACITY : 1 }}
      >
        {blocked.size === 0 ? null : (
          <AppText color={colors.statusDeclinedText} font="meta">
            {`Blocked out on ${[...blocked].map((day) => formatMonthDay(detail.month, day)).join(", ")}`}
          </AppText>
        )}
        {groups.length === 0 ? (
          <AppText color={colors.inkSecondary} font="rowDetail">
            {`Nothing scheduled in ${detail.month.label}.`}
          </AppText>
        ) : null}
        {groups.map((group) => (
          <View key={group.title ?? "month"}>
            {group.title === null ? null : (
              <View style={styles.groupTitle}>
                <SectionHeader title={group.title} />
              </View>
            )}
            {group.entries.map((entry, index) => {
              const plan = commitmentPlan(entry);
              const day = formatMonthDay(detail.month, entry.day);
              const text = describeCommitment(entry);
              const isBlocked = blocked.has(entry.day);
              return (
                <View
                  key={`${entry.day}-${entry.kind}-${entry.positionName ?? ""}-${entry.serviceTypeName ?? ""}-${entry.status ?? ""}`}
                >
                  {index === 0 ? null : (
                    <Hairline color={colors.hairlineSubtle} />
                  )}
                  <Pressable
                    accessibilityHint={
                      plan === null ? undefined : "Opens the plan"
                    }
                    accessibilityLabel={`${day}, ${text}${isBlocked ? ", blocked out" : ""}`}
                    accessibilityRole={plan === null ? "text" : "button"}
                    disabled={plan === null}
                    onPress={() => {
                      if (plan !== null) {
                        onOpenPlan(plan);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <AppText
                      color={group.isPast ? colors.inkSecondary : colors.ink}
                      font="rowTitleEmphasized"
                      tabular
                    >
                      {plan === null ? day : `${day} ›`}
                    </AppText>
                    <AppText color={colors.inkSecondary} font="meta">
                      {isBlocked ? `${text}${SEPARATOR}Blocked out` : text}
                    </AppText>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
        {detail.requestBudget.unresolvedRehearsalTimes > 0 ? (
          <AppText color={colors.inkSecondary} font="meta">
            Some rehearsal times couldn&apos;t be loaded, so those show on the
            service date.
          </AppText>
        ) : null}
      </View>
    </Card>
  );
};

/** Upcoming dates they can't serve, read on each blockout's own calendar. */
const Blockouts = ({ model }: { model: PersonDetailModel }) => {
  const zone = useOrgTimeZone();
  const { blockouts } = model;
  let body: ReactNode;
  if (blockouts !== undefined) {
    body =
      blockouts.length === 0 ? (
        <AppText color={colors.inkSecondary} font="rowDetail">
          No upcoming blockouts.
        </AppText>
      ) : (
        sortBlockouts(blockouts).map((blockout) => {
          const length = describeBlockoutLength(blockout, zone);
          const dates = describeBlockoutDates(blockout, zone, model.todayKey);
          const reason =
            blockout.reason === "" ? "Blocked out" : blockout.reason;
          const away = isAwayNow(blockout, model.now);
          return (
            <View
              accessibilityLabel={[
                reason,
                away ? "Away now" : null,
                dates,
                length,
                blockout.description,
              ]
                .filter((part) => part !== null && part !== "")
                .join(", ")}
              accessible
              key={blockout.id}
              style={styles.row}
            >
              <View style={styles.rowTitle}>
                <AppText color={colors.ink} font="rowTitleEmphasized">
                  {reason}
                </AppText>
                {away ? <StatusBadge title="Away now" tone="declined" /> : null}
                {length === null ? null : (
                  <AppText color={colors.inkSecondary} font="meta" tabular>
                    {length}
                  </AppText>
                )}
              </View>
              <AppText color={colors.ink} font="rowDetail" tabular>
                {dates}
              </AppText>
              {blockout.description === "" ? null : (
                <AppText color={colors.inkSecondary} font="meta">
                  {blockout.description}
                </AppText>
              )}
            </View>
          );
        })
      );
  } else if (model.blockoutsErrorMessage === null) {
    body = <Skeleton height={12} variant="text" width={180} />;
  } else {
    body = (
      <InfoBanner
        action={
          <PillButton
            kind="outline"
            onPress={() => {
              void model.retryBlockouts();
            }}
            size="small"
            title="Retry"
          />
        }
        message={`Blockouts failed to load. ${model.blockoutsErrorMessage}`}
        tone="destructive"
      />
    );
  }
  return (
    <Card
      subtitle={
        blockouts === undefined ? undefined : `${blockouts.length} upcoming`
      }
      testID={peopleTestIds.blockouts}
      title="Blockouts"
    >
      {body}
    </Card>
  );
};

const Signals = ({ model }: { model: PersonDetailModel }) => (
  <Card title="Signals">
    {model.signals.length === 0 ? (
      <AppText color={colors.inkSecondary} font="rowDetail">
        Nothing needs attention.
      </AppText>
    ) : (
      model.signals.map((signal) => {
        const text = describeSignal(signal);
        return (
          <View accessible key={signal.kind} style={styles.row}>
            <AppText color={colors.ink} font="rowTitleEmphasized">
              {text.label}
            </AppText>
            <AppText color={colors.inkSecondary} font="meta">
              {text.detail}
            </AppText>
          </View>
        );
      })
    )}
  </Card>
);

const Loaded = ({
  model,
  detail,
}: {
  model: PersonDetailModel;
  detail: PersonDetail;
}) => {
  const router = useRouter();
  const navigationPath = useNavigationPath();
  const openPlan = (plan: PlanIds) => {
    router.push(navigationPath(planHref(plan, "Lineup")));
  };
  const name = model.name ?? detail.person.name;
  return (
    <>
      <View accessible style={styles.header}>
        <PersonAvatar
          name={name}
          photoUrl={detail.person.photoThumbnailUrl}
          size="hero"
        />
        <View style={styles.headerText}>
          {model.subtitle === "" ? null : (
            <AppText color={colors.inkSecondary} font="rowDetail">
              {model.subtitle}
            </AppText>
          )}
          <SignalChips signals={model.signals} />
        </View>
      </View>
      {model.detailErrorMessage === null ? null : (
        <View style={styles.card}>
          <InfoBanner
            action={
              <PillButton
                kind="outline"
                onPress={() => {
                  void model.retryDetail();
                }}
                size="small"
                title="Retry"
              />
            }
            message={`Couldn't load this month. ${model.detailErrorMessage}`}
            tone="destructive"
          />
        </View>
      )}
      <ServingNumbers rhythm={detail.person.rhythm} />
      <Month detail={detail} model={model} onOpenPlan={openPlan} />
      <Signals model={model} />
      <Rotation
        detail={detail}
        onOpenPlan={openPlan}
        todayKey={model.todayKey}
      />
      <Blockouts model={model} />
    </>
  );
};

const Body = ({ model }: { model: PersonDetailModel }) => {
  if (model.detail !== undefined) {
    return <Loaded detail={model.detail} model={model} />;
  }
  if (model.isNotInServices) {
    return (
      <View style={styles.empty}>
        <EmptyState
          artwork="people"
          description="They’re in Planning Center People but not on a Services team or schedule yet, so there’s no serving history to show."
          title="Not in Services yet"
        />
      </View>
    );
  }
  if (model.detailErrorMessage !== null) {
    return (
      <View style={styles.empty}>
        <EmptyState
          actions={
            <PillButton
              kind="secondary"
              onPress={() => {
                void model.retryDetail();
              }}
              title="Retry"
            />
          }
          artwork="alert"
          description={model.detailErrorMessage}
          title="Person details failed to load"
        />
      </View>
    );
  }
  return (
    <SurfaceCard padding="none" style={styles.card}>
      <SkeletonRow detailWidth={180} titleWidth={140} />
      <SkeletonRow detailWidth={120} titleWidth={100} />
      <SkeletonRow detailWidth={160} titleWidth={120} />
    </SurfaceCard>
  );
};

/**
 * One person (Swift `PersonDetailView`, the web's person page): their teams and roles, serving
 * numbers and signals, the month with its schedule and blocked-out days, rotation, and upcoming
 * blockouts, titled with their name. `?month=YYYY-MM` opens another month.
 */
export const PersonScreen = () => {
  const params = useLocalSearchParams<{
    "person-id": string;
    month?: string;
  }>();
  const personId = params["person-id"] ?? "";
  const model = usePersonDetail(personId, parseMonthParam(params.month));
  const openPlanningCenter = useOpenPlanningCenterPerson();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const title = model.name ?? "";
  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLargeTitleEnabled: true,
          headerTitleStyle: { color: colors.ink },
          headerLargeTitleStyle: { color: colors.ink },
          unstable_headerRightItems: () => [
            {
              type: "button",
              label: "Open in Planning Center",
              accessibilityLabel: `Open ${title === "" ? "this person" : title} in Planning Center`,
              identifier: peopleTestIds.openPlanningCenter,
              icon: { type: "sfSymbol", name: "arrow.up.right.square" },
              onPress: () => {
                openPlanningCenter(personId);
              },
            },
          ],
        }}
      />
      {model.isFeatureOff ? (
        <View style={styles.empty}>
          <EmptyState
            artwork="people"
            description="People isn't turned on for this account."
            title="People"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              onRefresh={() => {
                setIsRefreshing(true);
                void (async () => {
                  await model.refresh();
                  setIsRefreshing(false);
                })();
              }}
              refreshing={isRefreshing}
            />
          }
          style={styles.scroll}
          testID={peopleTestIds.person(personId)}
        >
          <Body model={model} />
        </ScrollView>
      )}
    </>
  );
};
