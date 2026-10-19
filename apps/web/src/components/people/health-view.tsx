import type { PeopleDashboardRosterPerson } from "@pcobooster/contracts/http/people-schemas";

import {
  TeamCheckIns,
  TeamDueList,
  WaitingOnReplyList,
} from "@/components/people/team-attention";
import type { ListProgress } from "@/components/people/team-attention";
import { TeamHealthSummary } from "@/components/people/team-health-summary";
import { TeamRoster } from "@/components/people/team-roster";
import { Button } from "@/components/ui/button";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import type {
  PeopleDashboardCoverage,
  PeopleDashboardRow,
} from "@/lib/people-dashboard";
import type { PersonSignal, TeamHealth } from "@/lib/team-health";

interface PersonCallbacks {
  getPersonIntentProps: GetIntentPrefetchProps<PeopleDashboardRosterPerson>;
  onOpenPerson: (person: PeopleDashboardRosterPerson) => void;
}

const peopleCount = (count: number) =>
  `${count} ${count === 1 ? "person" : "people"}`;

interface PeopleHealthViewProps extends PersonCallbacks {
  health: TeamHealth;
  scopeLabel: string;
  coverage: PeopleDashboardCoverage | undefined;
  /** The scope's first people, shown when there is no search. */
  sampleRows: readonly PeopleDashboardRow[];
  isRosterLoading: boolean;
  /** Activity is still loading for the sample. */
  isLoadingSample: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
  search: {
    active: boolean;
    rows: readonly PeopleDashboardRow[];
    /** Signals for every loaded match, including people beyond the sample. */
    signalsById: ReadonlyMap<string, readonly PersonSignal[]>;
    unrequestedMatchCount: number;
    onLoadMoreMatches: () => void;
  };
}

/** A leader's view of their team: overall health, who to reach out to, who to schedule. */
export const PeopleHealthView = ({
  health,
  scopeLabel,
  coverage,
  sampleRows,
  isRosterLoading,
  isLoadingSample,
  canLoadMore,
  onLoadMore,
  search,
  getPersonIntentProps,
  onOpenPerson,
}: PeopleHealthViewProps) => {
  const callbacks = { getPersonIntentProps, onOpenPerson };
  const { onLoadMoreMatches } = search;
  if (search.active) {
    return (
      <TeamRoster
        rows={search.rows}
        signalsById={search.signalsById}
        teamPace={health.teamPace}
        isLoading={isRosterLoading}
        empty="No people match this search."
        footer={
          search.rows.length === 0 ? undefined : (
            <>
              <span>
                {search.rows.length === 1
                  ? "1 match"
                  : `${search.rows.length} matches`}
                {search.unrequestedMatchCount > 0
                  ? `, ${search.unrequestedMatchCount} not loaded yet`
                  : null}
              </span>
              {search.unrequestedMatchCount > 0 ? (
                <Button variant="link" size="xs" onClick={onLoadMoreMatches}>
                  Load more
                </Button>
              ) : null}
            </>
          )
        }
        {...callbacks}
      />
    );
  }

  const loadedNobody =
    coverage === undefined || coverage.loadedPeopleCount === 0;
  let progress: ListProgress = "complete";
  if (isRosterLoading || (loadedNobody && isLoadingSample)) {
    progress = "loading";
  } else if (isLoadingSample) {
    progress = "partial";
  }
  const sampled =
    coverage !== undefined &&
    coverage.samplePeopleCount < coverage.scopePeopleCount;

  return (
    <div className="flex shrink-0 flex-col gap-3">
      <TeamHealthSummary
        health={health}
        scopeLabel={scopeLabel}
        coverage={coverage}
        isLoadingActivity={isRosterLoading || isLoadingSample}
        canLoadMore={canLoadMore}
        onLoadMore={onLoadMore}
      />
      <div className="grid grid-cols-1 items-start gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <WaitingOnReplyList
          entries={health.waitingOnReply}
          progress={progress}
          {...callbacks}
        />
        <TeamCheckIns
          entries={health.checkIns}
          progress={progress}
          {...callbacks}
        />
        <TeamDueList
          entries={health.dueForSlot}
          progress={progress}
          {...callbacks}
        />
      </div>
      <TeamRoster
        rows={sampleRows}
        signalsById={health.signalsById}
        teamPace={health.teamPace}
        isLoading={isRosterLoading}
        empty="No one is on these teams."
        footer={
          sampled ? (
            <>
              <span>
                The first {coverage.samplePeopleCount} of{" "}
                {peopleCount(coverage.scopePeopleCount)}, by last name
              </span>
              {canLoadMore ? (
                <Button variant="link" size="xs" onClick={onLoadMore}>
                  Load more
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        {...callbacks}
      />
    </div>
  );
};
