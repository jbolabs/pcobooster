import { speculativeQuery } from "@pcobooster/client/query";
import type {
  PeopleDashboardPerson,
  PeopleDashboardRosterPerson,
  PeopleDashboardTeam,
} from "@pcobooster/contracts/http/people-schemas";
import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { CircleAlert, Search } from "lucide-react";
import { useCallback, useDeferredValue, useMemo, useState } from "react";

import { PageShell } from "@/components/page-shell";
import {
  CoverageNote,
  PeopleDashboardProgress,
} from "@/components/people/dashboard-progress";
import { PeopleHealthView } from "@/components/people/health-view";
import { MonthView, MonthViewSkeleton } from "@/components/people/month-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { LoadingBar } from "@/components/ui/loading-bar";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { usePeopleDashboard } from "@/hooks/use-people-dashboard";
import { createPeopleDashboardPersonQueryOptions } from "@/hooks/use-people-dashboard-person";
import { isQueryFresh } from "@/lib/intent-prefetch";
import {
  parsePeopleDashboardScope,
  scopeTeamIds,
  teamScope,
} from "@/lib/people-dashboard";
import type {
  PeopleDashboardScope,
  PeopleDashboardView,
} from "@/lib/people-dashboard";
import { computePersonSignals, computeTeamHealth } from "@/lib/team-health";

const EMPTY_MEMBERS: PeopleDashboardPerson[] = [];
const EMPTY_TEAMS: PeopleDashboardTeam[] = [];
const EMPTY_TEAM_IDS: string[] = [];
const NO_SIGNALS = new Map();
const OTHER_SERVICE_TYPE = "Other teams";

const teamLabel = (team: PeopleDashboardTeam) =>
  team.serviceTypeName === null
    ? team.name
    : `${team.name} · ${team.serviceTypeName}`;

const describeScope = (
  scope: PeopleDashboardScope,
  teams: readonly PeopleDashboardTeam[],
  ledTeamIds: readonly string[]
) => {
  const teamIds = scopeTeamIds(scope, ledTeamIds);
  if (teamIds === null) {
    return "All teams";
  }
  const [onlyTeamId] = teamIds;
  const onlyTeam =
    teamIds.length === 1
      ? teams.find((team) => team.id === onlyTeamId)
      : undefined;
  if (onlyTeam !== undefined) {
    return teamLabel(onlyTeam);
  }
  return "Teams you lead";
};

/** Teams grouped by service type, in roster order within each group. */
const groupTeams = (teams: readonly PeopleDashboardTeam[]) => {
  const groups = new Map<string, PeopleDashboardTeam[]>();
  for (const team of teams) {
    const key = team.serviceTypeName ?? OTHER_SERVICE_TYPE;
    const group = groups.get(key) ?? [];
    group.push(team);
    groups.set(key, group);
  }
  return [...groups.entries()].toSorted(([a], [b]) => {
    if (a === OTHER_SERVICE_TYPE || b === OTHER_SERVICE_TYPE) {
      return a === OTHER_SERVICE_TYPE ? 1 : -1;
    }
    return a.localeCompare(b);
  });
};

const ScopeSelect = ({
  scope,
  teams,
  ledTeamIds,
  onChange,
}: {
  scope: PeopleDashboardScope;
  teams: readonly PeopleDashboardTeam[];
  ledTeamIds: readonly string[];
  onChange: (scope: PeopleDashboardScope) => void;
}) => {
  const groups = useMemo(() => groupTeams(teams), [teams]);
  return (
    <NativeSelect
      className="w-full"
      aria-label="Choose teams"
      value={scope}
      onChange={(event) => {
        const next = parsePeopleDashboardScope(event.target.value);
        if (next !== null) {
          onChange(next);
        }
      }}
    >
      {ledTeamIds.length > 0 ? (
        <NativeSelectOption value="mine">Teams I lead</NativeSelectOption>
      ) : null}
      <NativeSelectOption value="all">All teams</NativeSelectOption>
      {groups.map(([serviceType, groupTeamsList]) => (
        <NativeSelectOptGroup key={serviceType} label={serviceType}>
          {groupTeamsList.map((team) => (
            <NativeSelectOption key={team.id} value={teamScope(team.id)}>
              {team.name}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
    </NativeSelect>
  );
};

const RosterError = ({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean;
  onRetry: () => void;
}) => (
  <Alert>
    <CircleAlert aria-hidden />
    <AlertTitle>Couldn&apos;t load your teams</AlertTitle>
    <AlertDescription>
      <p>Planning Center didn&apos;t answer. Try again in a moment.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isRetrying}
        onClick={onRetry}
      >
        {isRetrying ? "Retrying…" : "Retry"}
      </Button>
    </AlertDescription>
  </Alert>
);

/** Team health and the month for the teams a leader chooses; view and teams live in the URL. */
export const PeoplePage = ({
  view,
  scopeChoice,
}: {
  view: PeopleDashboardView;
  scopeChoice: PeopleDashboardScope | null;
}) => {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgTimeZone = useOrganizationTimeZone();
  const todayKey = formatCalendarDayInTimeZone(new Date(), orgTimeZone);
  const {
    scope,
    dashboard,
    isRosterLoading,
    isRosterError,
    isRetryingRoster,
    retryRoster,
    isFetching,
    isLoadingActivity,
    failedBatchCount,
    retryFailed,
    canLoadMore,
    loadMore,
    searchRows,
    unrequestedMatchCount,
    loadMoreMatches,
  } = usePeopleDashboard({ scopeChoice, searchQuery: deferredQuery });
  const members = dashboard?.members ?? EMPTY_MEMBERS;
  const teams = dashboard?.teams ?? EMPTY_TEAMS;
  const ledTeamIds = dashboard?.ledTeamIds ?? EMPTY_TEAM_IDS;
  const scopeLabel = describeScope(scope, teams, ledTeamIds);
  const searching = deferredQuery.trim() !== "";
  const isLoadingSample =
    dashboard?.sampleRows.some((row) => row.loading) ?? isRosterLoading;

  const health = useMemo(
    () => computeTeamHealth(members, teams, todayKey),
    [members, teams, todayKey]
  );
  // Matches beyond the sample load on demand; they carry signals too.
  const searchMembers = useMemo(
    () => searchRows.flatMap(({ member }) => (member === null ? [] : [member])),
    [searchRows]
  );
  const searchSignals = useMemo(
    () =>
      searching
        ? computePersonSignals(
            dashboard?.scopeRows.flatMap(({ member }) =>
              member === null ? [] : [member]
            ) ?? EMPTY_MEMBERS,
            teams,
            todayKey
          )
        : NO_SIGNALS,
    [dashboard, searching, teams, todayKey]
  );

  // View and teams live in the URL, so Back from a person returns to the same place.
  const showView = useCallback(
    (next: PeopleDashboardView) => {
      void navigate({
        to: "/people",
        search: (previous) => ({
          ...previous,
          view: next === "month" ? "month" : undefined,
        }),
        replace: true,
      });
    },
    [navigate]
  );
  const showScope = useCallback(
    (next: PeopleDashboardScope) => {
      void navigate({
        to: "/people",
        search: (previous) => ({ ...previous, scope: next }),
        replace: true,
      });
    },
    [navigate]
  );

  const prefetchPersonDetail = useCallback(
    async (person: PeopleDashboardRosterPerson) => {
      void router.preloadRoute({
        to: "/people/$personId",
        params: { personId: person.id },
      });
      await queryClient.query(
        speculativeQuery(
          createPeopleDashboardPersonQueryOptions(person.id, null)
        )
      );
    },
    [queryClient, router]
  );
  // A cold person detail can spend a whole call's Planning Center budget (schedules, plan
  // people, and rehearsal times), so hovering or tabbing past a row must not load it.
  const { getIntentProps: getPersonIntentProps, cancelIntent } =
    useIntentPrefetch<PeopleDashboardRosterPerson>({
      keyOf: (person) => person.id,
      isFresh: (person) => {
        const options = createPeopleDashboardPersonQueryOptions(
          person.id,
          null
        );
        return isQueryFresh(queryClient, options.queryKey, options.staleTime);
      },
      prefetch: prefetchPersonDetail,
    });
  const openPerson = useCallback(
    (person: PeopleDashboardRosterPerson) => {
      cancelIntent();
      void navigate({
        to: "/people/$personId",
        params: { personId: person.id },
      });
    },
    [cancelIntent, navigate]
  );
  const callbacks = { getPersonIntentProps, onOpenPerson: openPerson };

  const renderContent = () => {
    if (isRosterError) {
      return (
        <RosterError isRetrying={isRetryingRoster} onRetry={retryRoster} />
      );
    }
    if (view === "health") {
      return (
        <PeopleHealthView
          health={health}
          scopeLabel={scopeLabel}
          coverage={dashboard?.coverage}
          sampleRows={dashboard?.sampleRows ?? []}
          isRosterLoading={isRosterLoading}
          isLoadingSample={isLoadingSample}
          canLoadMore={canLoadMore}
          onLoadMore={loadMore}
          search={{
            active: searching,
            rows: searchRows,
            signalsById: searchSignals,
            unrequestedMatchCount,
            onLoadMoreMatches: loadMoreMatches,
          }}
          {...callbacks}
        />
      );
    }
    if (
      dashboard === undefined ||
      (dashboard.coverage.loadedPeopleCount === 0 && isLoadingSample)
    ) {
      return <MonthViewSkeleton />;
    }
    const monthKey = `${dashboard.month.year}-${String(dashboard.month.monthIndex + 1).padStart(2, "0")}`;
    return (
      <MonthView
        people={searching ? searchMembers : members}
        month={dashboard.month}
        today={todayKey.startsWith(monthKey) ? Number(todayKey.slice(8)) : null}
        coverageNote={
          searching ? null : (
            <CoverageNote
              coverage={dashboard.coverage}
              isLoading={isLoadingSample}
              canLoadMore={canLoadMore}
              onLoadMore={loadMore}
            />
          )
        }
        {...callbacks}
      />
    );
  };

  return (
    <PageShell>
      <header className="flex shrink-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 max-md:contents">
          <div className="min-w-0 max-md:hidden">
            <h1 className="truncate text-xl font-semibold tracking-tight max-md:sr-only md:text-2xl">
              People
            </h1>
            <p className="text-muted-foreground text-sm max-md:hidden">
              Team health, who to check in with, and who is due to serve.
            </p>
          </div>
          <Tabs
            value={view}
            onValueChange={(value) => {
              showView(value === "month" ? "month" : "health");
            }}
          >
            <TabsList className="h-8 max-md:h-10 max-md:w-full">
              <TabsTrigger value="health">Health</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="grid shrink-0 items-center gap-2 md:grid-cols-[minmax(0,1fr)_16rem]">
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search people, teams, or roles"
              aria-label="Search people"
            />
          </InputGroup>
          <ScopeSelect
            scope={scope}
            teams={teams}
            ledTeamIds={ledTeamIds}
            onChange={showScope}
          />
        </div>
      </header>

      <LoadingBar
        active={isFetching && !isRosterError}
        className="-my-1.5 shrink-0"
      />

      <PeopleDashboardProgress
        coverage={dashboard?.coverage}
        isLoadingActivity={isLoadingActivity}
        failedBatchCount={failedBatchCount}
        onRetry={retryFailed}
      />

      <div className="shrink-0" aria-busy={isRosterLoading}>
        {renderContent()}
      </div>
    </PageShell>
  );
};
