import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type {
  PlanDayGroup,
  ServicePlanRow,
} from "@pcobooster/planning-center-models/service-plans";
import {
  formatPlanDate,
  formatPlanDateTile,
  formatPlanDetail,
  formatPlanRelativeDay,
  groupPlansByMonthAndDay,
} from "@pcobooster/planning-center-models/service-plans";
import { ChevronRight, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { PageScrollArea } from "@/components/page-shell";
import { QueryDataBoundary } from "@/components/query-data-boundary";
import { ServiceTypeMultiSelect } from "@/components/service-type-multi-select";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Item } from "@/components/ui/item";
import { LoadingBar } from "@/components/ui/loading-bar";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { selectionPickerSectionTitleClass } from "@/components/ui/selection-picker-styles";
import { Skeleton } from "@/components/ui/skeleton";
import { useEarlierPlansIntent } from "@/hooks/use-earlier-plans-intent";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { useServicePlanSelection } from "@/hooks/use-service-plan-selection";
import { currentDate } from "@/lib/clock";
import type { ServicePlanTableSelectorProps } from "@/lib/service-plan-selection";
import { cn } from "@/lib/utils";

interface PlanListProps {
  isInitialLoading: boolean;
  errorMessage: Error | undefined;
  visibleRows: ServicePlanRow[];
  selectedPlanId: string | null;
  myScheduledPlanIdSet: Set<string>;
  handleSelectRow: (row: ServicePlanRow) => void;
  getPlanIntentProps: GetIntentPrefetchProps<ServicePlanRow>;
  orgTimeZone: string;
}

const PlanDateTile = ({
  date,
  orgTimeZone,
  isToday = false,
  className,
}: {
  date: Date;
  orgTimeZone: string;
  isToday?: boolean;
  className?: string;
}) => {
  const tile = formatPlanDateTile(date, orgTimeZone);
  return (
    <span
      aria-hidden
      className={cn(
        "flex w-12 shrink-0 flex-col items-center justify-center rounded-xl py-1.5 leading-none tabular-nums",
        isToday ? "bg-foreground text-background" : "bg-muted text-foreground",
        className
      )}
    >
      <span className="text-xs font-semibold tracking-wide uppercase opacity-70">
        {tile.month}
      </span>
      <span className="mt-0.5 text-lg font-semibold">{tile.day}</span>
      <span className="mt-0.5 text-xs font-medium opacity-60">
        {tile.weekday}
      </span>
    </span>
  );
};

/** A pill on wider screens; just the dot on phones, where titles need the room. */
const ScheduledBadge = () => (
  <span
    aria-hidden
    className="text-status-confirmed sm:bg-status-confirmed/12 inline-flex shrink-0 items-center gap-1.5 rounded-full text-xs font-medium sm:px-2 sm:py-0.5"
  >
    <span className="bg-status-confirmed size-2 rounded-full sm:size-1.5" />
    <span className="max-sm:hidden">You&apos;re on</span>
  </span>
);

const PlanAgendaRow = ({
  row,
  isActive,
  isScheduledForCurrentUser,
  onSelect,
  getPlanIntentProps,
  orgTimeZone,
}: {
  row: ServicePlanRow;
  isActive: boolean;
  isScheduledForCurrentUser: boolean;
  onSelect: (row: ServicePlanRow) => void;
  getPlanIntentProps: GetIntentPrefetchProps<ServicePlanRow>;
  orgTimeZone: string;
}) => {
  const detail = formatPlanDetail(row);
  const label = `${row.serviceTypeName}, ${formatPlanDate(row.sortDate, orgTimeZone)}`;
  return (
    <Item
      size="xs"
      variant={isActive ? "muted" : "default"}
      className="min-h-12"
      render={
        <button
          type="button"
          data-plan-key={`${row.serviceTypeId}:${row.planId}`}
          aria-current={isActive ? "page" : undefined}
          aria-label={
            isScheduledForCurrentUser ? `${label}: you are scheduled` : label
          }
        />
      }
      {...getPlanIntentProps(row)}
      onClick={() => {
        onSelect(row);
      }}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">
          {row.serviceTypeName}
        </span>
        {detail === null ? null : (
          <span className="text-muted-foreground block min-w-0 text-sm">
            <MiddleTruncate text={detail} />
          </span>
        )}
      </span>
      {isScheduledForCurrentUser ? <ScheduledBadge /> : null}
      <ChevronRight
        className="text-muted-foreground/60 size-4 shrink-0 md:opacity-0 md:group-hover/item:opacity-100 md:group-focus-visible/item:opacity-100"
        aria-hidden
      />
    </Item>
  );
};

const PlanAgendaDay = ({
  day,
  todayKey,
  selectedPlanId,
  myScheduledPlanIdSet,
  handleSelectRow,
  getPlanIntentProps,
  orgTimeZone,
}: Omit<PlanListProps, "isInitialLoading" | "errorMessage" | "visibleRows"> & {
  day: PlanDayGroup;
  todayKey: string;
}) => (
  <li className="flex items-center gap-3 py-2 md:gap-4">
    <PlanDateTile
      date={day.date}
      orgTimeZone={orgTimeZone}
      isToday={day.dayKey === todayKey}
    />
    <ul className="flex min-w-0 flex-1 flex-col gap-0.5">
      {day.rows.map((row) => (
        <li key={`${row.serviceTypeId}:${row.planId}`}>
          <PlanAgendaRow
            row={row}
            isActive={row.planId === selectedPlanId}
            isScheduledForCurrentUser={myScheduledPlanIdSet.has(row.planId)}
            onSelect={handleSelectRow}
            getPlanIntentProps={getPlanIntentProps}
            orgTimeZone={orgTimeZone}
          />
        </li>
      ))}
    </ul>
  </li>
);

const planAgendaSkeletonDays = [2, 1, 3, 1, 2, 1];

export const PlanAgendaSkeleton = () => (
  <div className="flex flex-col">
    <Skeleton variant="text" className="mt-1 mb-2 h-3 w-24" />
    <div className="divide-border flex flex-col divide-y">
      {planAgendaSkeletonDays.map((rowCount, dayIndex) => (
        <div key={dayIndex} className="flex gap-3 py-2 md:gap-4">
          <Skeleton className="h-16 w-12 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {Array.from({ length: rowCount }, (_, rowIndex) => (
              <div
                key={rowIndex}
                className="flex min-h-12 flex-col justify-center gap-2 px-3"
              >
                <Skeleton variant="text" className="h-3 w-40 max-w-full" />
                <Skeleton variant="text" className="h-3 w-56 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const PlanListEmpty = ({
  title,
  description,
}: {
  title: string;
  description: string;
}) => (
  <div className="py-10">
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>
);

const PlanAgenda = ({
  isInitialLoading,
  errorMessage,
  visibleRows,
  ...dayProps
}: PlanListProps) => {
  if (isInitialLoading) {
    return <PlanAgendaSkeleton />;
  }
  if (errorMessage && visibleRows.length === 0) {
    return null;
  }
  if (visibleRows.length === 0) {
    return (
      <PlanListEmpty
        title="No matching plans"
        description="Adjust the search or service types, or load more services."
      />
    );
  }
  const todayKey = formatCalendarDayInTimeZone(
    currentDate(),
    dayProps.orgTimeZone
  );
  return groupPlansByMonthAndDay(visibleRows, dayProps.orgTimeZone).map(
    (month) => (
      <section key={month.heading} aria-label={month.heading}>
        <h3 className="bg-background text-muted-foreground sticky top-[var(--plan-list-sticky-offset,0px)] z-[5] -mx-4 px-4 pt-4 pb-1.5 text-xs font-semibold tracking-wide uppercase md:top-0 md:mx-0 md:px-0">
          {month.heading}
        </h3>
        <ul className="divide-border flex flex-col divide-y">
          {month.days.map((day) => (
            <PlanAgendaDay
              key={day.dayKey}
              day={day}
              todayKey={todayKey}
              {...dayProps}
            />
          ))}
        </ul>
      </section>
    )
  );
};

interface MyScheduledServiceCardsProps {
  rows: ServicePlanRow[];
  isLoading: boolean;
  onSelect: (row: ServicePlanRow) => void;
  getPlanIntentProps: GetIntentPrefetchProps<ServicePlanRow>;
  orgTimeZone: string;
}

const myScheduledServiceCardClass =
  "w-[min(18rem,80vw)] shrink-0 snap-start md:w-full";

const MyScheduledServiceCards = ({
  rows,
  isLoading,
  onSelect,
  getPlanIntentProps,
  orgTimeZone,
}: MyScheduledServiceCardsProps) => {
  if (!isLoading && rows.length === 0) {
    return null;
  }

  const now = currentDate();
  return (
    <section
      data-tour="your-services"
      className="flex shrink-0 flex-col gap-2.5"
    >
      <h2 className={selectionPickerSectionTitleClass}>Your services</h2>
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                key={`my-service-card-skeleton-${index}`}
                className={cn(myScheduledServiceCardClass, "h-[5.25rem]")}
              />
            ))
          : rows.map((row) => {
              const relativeDay = formatPlanRelativeDay(
                row.sortDate,
                now,
                orgTimeZone
              );
              return (
                <Item
                  key={`${row.serviceTypeId}:${row.planId}`}
                  variant="outline"
                  size="sm"
                  className={myScheduledServiceCardClass}
                  render={
                    <button
                      type="button"
                      aria-label={`${row.serviceTypeName}, ${formatPlanDate(row.sortDate, orgTimeZone)}`}
                    />
                  }
                  {...getPlanIntentProps(row)}
                  onClick={() => {
                    onSelect(row);
                  }}
                >
                  <PlanDateTile date={row.sortDate} orgTimeZone={orgTimeZone} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {relativeDay === null ? null : (
                      <span className="text-status-confirmed text-xs font-medium">
                        {relativeDay}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium">
                      {row.serviceTypeName}
                    </span>
                    {isNonEmptyString(row.planTitle) ? (
                      <span className="text-muted-foreground block min-w-0 text-sm">
                        <MiddleTruncate text={row.planTitle} />
                      </span>
                    ) : null}
                  </span>
                </Item>
              );
            })}
      </div>
    </section>
  );
};

const PersonalScheduleStatus = ({
  loading,
  hasMore,
  failed,
}: {
  loading: boolean;
  hasMore: boolean;
  failed: boolean;
}) => {
  let message = "All your assignments are loaded.";
  if (loading) {
    message = "Loading your assignments…";
  } else if (failed) {
    message = "Your schedule couldn't finish loading. Retry above.";
  } else if (hasMore) {
    message =
      "Search covers loaded assignments; load more to search further back.";
  }
  return (
    <output className="text-muted-foreground py-2 text-xs">
      Past and future assignments, newest first. {message}
    </output>
  );
};

const ServicesLoadMore = ({
  hidden,
  loading,
  disabled,
  personal,
  onLoad,
}: {
  hidden: boolean;
  loading: boolean;
  disabled: boolean;
  personal: boolean;
  onLoad: () => void;
}) => {
  if (hidden) {
    return null;
  }
  let label = personal ? "Load more assignments" : "Load next 2 weeks";
  if (loading) {
    label = "Loading services…";
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onLoad}
    >
      {label}
    </Button>
  );
};

export const ServicePlanTableSelector = ({
  selectedServiceTypeId,
  selectedPlanId,
  isNavigating = false,
  onSelect,
}: ServicePlanTableSelectorProps) => {
  const {
    searchValue,
    setSearchValue,
    onlyMyServices,
    setOnlyMyServices,
    hasMoreMyServices,
    loadMoreMyServices,
    serviceTypes,
    effectiveSelectedServiceTypeIds,
    setSelectedServiceTypeIds,
    loadLaterWeeks,
    loadEarlierWeeks,
    canAutoLoadMore,
    latestStartDay,
    isInitialLoading,
    isRefreshing,
    errorMessage,
    failedQueries,
    visibleRows,
    myScheduledRows,
    myScheduledPlanIdSet,
    handleSelectRow,
    getPlanIntentProps,
    orgTimeZone,
  } = useServicePlanSelection({
    selectedServiceTypeId,
    selectedPlanId,
    onSelect,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const laterRef = useRef<HTMLDivElement>(null);
  const earlierRequestPending = useRef(false);
  const earlierAnchor = useRef<{
    element: Element;
    top: number;
    scrollPosition: number;
  } | null>(null);
  useEffect(() => {
    const target = laterRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          loadLaterWeeks();
        }
      },
      { rootMargin: "0px 0px 160px 0px" }
    );
    if (
      target !== null &&
      !isInitialLoading &&
      !isRefreshing &&
      canAutoLoadMore &&
      !errorMessage &&
      latestStartDay !== undefined
    ) {
      observer.observe(target);
    }
    return () => {
      observer.disconnect();
    };
  }, [
    canAutoLoadMore,
    errorMessage,
    isInitialLoading,
    isRefreshing,
    loadLaterWeeks,
    latestStartDay,
  ]);

  useLayoutEffect(() => {
    const anchor = earlierAnchor.current;
    const scroller = scrollRef.current;
    if (isRefreshing) {
      return;
    }
    earlierRequestPending.current = false;
    if (
      visibleRows.length === 0 ||
      anchor === null ||
      scroller === null ||
      !anchor.element.isConnected
    ) {
      earlierAnchor.current = null;
      return;
    }
    const scrollsHere = getComputedStyle(scroller).overflowY === "auto";
    const scrollPosition = scrollsHere ? scroller.scrollTop : window.scrollY;
    const delta =
      anchor.element.getBoundingClientRect().top -
      anchor.top +
      scrollPosition -
      anchor.scrollPosition;
    if (scrollsHere) {
      scroller.scrollTop += delta;
    } else {
      window.scrollBy(0, delta);
    }
    earlierAnchor.current = null;
  }, [isRefreshing, visibleRows]);

  const showEarlierWeeks = () => {
    if (earlierRequestPending.current) {
      return;
    }
    earlierRequestPending.current = true;
    const scroller = scrollRef.current;
    if (scroller !== null) {
      const top = Math.max(0, scroller.getBoundingClientRect().top);
      const element = [...scroller.querySelectorAll("[data-plan-key]")].find(
        (row) => row.getBoundingClientRect().bottom > top
      );
      if (element !== undefined) {
        earlierAnchor.current = {
          element,
          top: element.getBoundingClientRect().top,
          scrollPosition:
            getComputedStyle(scroller).overflowY === "auto"
              ? scroller.scrollTop
              : window.scrollY,
        };
      }
    }
    loadEarlierWeeks();
  };
  useEarlierPlansIntent({
    scrollRef,
    enabled:
      !onlyMyServices &&
      !isInitialLoading &&
      !isRefreshing &&
      !errorMessage &&
      effectiveSelectedServiceTypeIds.length > 0 &&
      searchValue.trim() === "",
    onEarlier: showEarlierWeeks,
  });
  return (
    <div className="flex flex-col gap-4 md:h-full md:min-h-0">
      {failedQueries.map(({ title, query }) => (
        <QueryDataBoundary key={title} title={title} query={query}>
          {null}
        </QueryDataBoundary>
      ))}
      <MyScheduledServiceCards
        rows={myScheduledRows}
        isLoading={isInitialLoading}
        onSelect={handleSelectRow}
        getPlanIntentProps={getPlanIntentProps}
        orgTimeZone={orgTimeZone}
      />

      <div className="flex flex-col [--plan-list-sticky-offset:6.25rem] md:min-h-0 md:flex-1">
        <div
          data-tour="plan-search"
          className="bg-background sticky top-0 z-10 -mx-4 grid shrink-0 grid-cols-2 gap-2 px-4 py-2 md:static md:mx-0 md:grid-cols-[minmax(0,1fr)_auto] md:bg-transparent md:px-0 md:pt-0 md:pb-1"
        >
          <InputGroup className="col-span-2 md:col-span-1">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={searchValue}
              onChange={(event) => {
                setSearchValue(event.target.value);
              }}
              placeholder={
                onlyMyServices
                  ? "Search your services, teams, or dates"
                  : "Search plans, series, or dates"
              }
              aria-label="Search services and plans"
            />
          </InputGroup>

          <div className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1">
            <Button
              type="button"
              variant={onlyMyServices ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={onlyMyServices}
              onClick={() => {
                setOnlyMyServices(!onlyMyServices);
              }}
            >
              Only my services
            </Button>
            <div className="min-w-0 flex-1 md:w-44 md:flex-none">
              <ServiceTypeMultiSelect
                options={serviceTypes ?? []}
                selectedIds={effectiveSelectedServiceTypeIds}
                onChange={setSelectedServiceTypeIds}
              />
            </div>
          </div>
        </div>

        <LoadingBar
          active={isNavigating || isRefreshing}
          className="shrink-0"
        />

        {onlyMyServices ? (
          <PersonalScheduleStatus
            loading={isInitialLoading || isRefreshing}
            hasMore={hasMoreMyServices}
            failed={!!errorMessage}
          />
        ) : null}
        <PageScrollArea ref={scrollRef}>
          <div className="[overflow-anchor:none]">
            <PlanAgenda
              isInitialLoading={isInitialLoading}
              errorMessage={errorMessage}
              visibleRows={visibleRows}
              selectedPlanId={selectedPlanId}
              myScheduledPlanIdSet={myScheduledPlanIdSet}
              handleSelectRow={handleSelectRow}
              getPlanIntentProps={getPlanIntentProps}
              orgTimeZone={orgTimeZone}
            />
            <div ref={laterRef} className="flex justify-center py-4">
              <ServicesLoadMore
                hidden={
                  isInitialLoading || (onlyMyServices && !hasMoreMyServices)
                }
                loading={isRefreshing}
                disabled={
                  isRefreshing ||
                  (!onlyMyServices &&
                    effectiveSelectedServiceTypeIds.length === 0) ||
                  !!errorMessage
                }
                personal={onlyMyServices}
                onLoad={onlyMyServices ? loadMoreMyServices : loadLaterWeeks}
              />
            </div>
          </div>
        </PageScrollArea>
      </div>
    </div>
  );
};
