import { speculativeQuery } from "@pcobooster/client/query";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ListMusic } from "lucide-react";
import { useState } from "react";

import { HotkeyChord } from "@/components/hotkey-chord";
import { PracticeSetlist } from "@/components/practice/practice-setlist";
import { PracticeStage } from "@/components/practice/practice-stage";
import { QueryDataBoundary } from "@/components/query-data-boundary";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HoverLabel } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllPlanFiles } from "@/hooks/use-all-plan-files";
import { createChordChartSongQueryOptions } from "@/hooks/use-chord-chart-song";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { usePlanItems } from "@/hooks/use-plan-items";
import { practiceBinding } from "@/lib/app-hotkeys";
import { isQueryFresh } from "@/lib/intent-prefetch";
import {
  adjacentStep,
  resolvePracticeItem,
  stepPosition,
} from "@/lib/practice";

const PLAN_VIEW_ROUTE = "/_app/services/$serviceTypeId/plans/$planId/$view";

/** Warms the song a Next or Previous press would open, once the pointer rests on it. */
const useStepPrefetch = () => {
  const queryClient = useQueryClient();
  return useIntentPrefetch<string>({
    keyOf: (songId) => songId,
    isFresh: (songId) => {
      const options = createChordChartSongQueryOptions(songId);
      return isQueryFresh(queryClient, options.queryKey, options.staleTime);
    },
    prefetch: async (songId) => {
      await queryClient.query(
        speculativeQuery(createChordChartSongQueryOptions(songId))
      );
    },
  });
};

const StepButton = ({
  direction,
  target,
  onSelect,
  intentProps,
}: {
  direction: "previous" | "next";
  target: PlanItem | null;
  onSelect: (item: PlanItem) => void;
  intentProps: ReturnType<
    ReturnType<typeof useStepPrefetch>["getIntentProps"]
  > | null;
}) => {
  const Icon = direction === "next" ? ChevronRight : ChevronLeft;
  const label = direction === "next" ? "Next song" : "Previous song";
  const shortcut = direction === "next" ? "practice.next" : "practice.previous";
  const binding = practiceBinding(shortcut);
  return (
    <HoverLabel
      label={
        <span className="flex items-center gap-2">
          {target === null ? label : `${label}: ${target.title}`}
          <HotkeyChord binding={binding} id={shortcut} />
        </span>
      }
      side="bottom"
      render={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={target === null ? label : `${label}: ${target.title}`}
          disabled={target === null}
          onClick={() => {
            if (target !== null) {
              onSelect(target);
            }
          }}
          {...intentProps}
        />
      }
    >
      <Icon />
    </HoverLabel>
  );
};

const PracticeSkeleton = () => (
  <div className="flex min-h-0 flex-1 gap-8" aria-hidden>
    <div className="flex w-56 shrink-0 flex-col gap-2 max-lg:hidden">
      {["a", "b", "c", "d", "e", "f"].map((row) => (
        <Skeleton key={row} variant="text" className="h-4 w-full" />
      ))}
    </div>
    <div className="flex flex-1 flex-col gap-3">
      <Skeleton variant="text" className="h-6 w-56" />
      <Skeleton variant="text" className="h-4 w-40" />
      <Skeleton variant="control" className="h-8 w-72" />
      <Skeleton variant="text" className="mt-4 h-4 w-64" />
      <Skeleton variant="text" className="h-4 w-60" />
      <Skeleton variant="text" className="h-4 w-52" />
    </div>
  </div>
);

export const PracticeTabSkeleton = PracticeSkeleton;

const EmptyPlan = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <ListMusic />
      </EmptyMedia>
      <EmptyTitle>Nothing to practice yet</EmptyTitle>
      <EmptyDescription>
        Songs added to this plan show up here with their charts and recordings.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

/**
 * Practice: step through the plan's songs to rehearse. The setlist sits on the left on wide
 * screens (a drawer on phones); the stage shows the song's chart in any key or capo, its
 * chart files and videos, and a player for its recordings. The item is in the URL, so a link
 * or a reload opens the same song.
 */
export const PracticeTab = ({
  serviceTypeId,
  planId,
}: {
  serviceTypeId: string;
  planId: string;
}) => {
  const itemsQuery = usePlanItems(serviceTypeId, planId);
  const { files, loading: filesLoading } = useAllPlanFiles(
    serviceTypeId,
    planId
  );
  const { item: itemId } = useSearch({ from: PLAN_VIEW_ROUTE });
  const navigate = useNavigate();
  const [setlistOpen, setSetlistOpen] = useState(false);
  const { getIntentProps } = useStepPrefetch();

  const items = itemsQuery.data ?? [];
  const current = resolvePracticeItem(items, itemId);
  const previous =
    current === null ? null : adjacentStep(items, current, "previous");
  const next = current === null ? null : adjacentStep(items, current, "next");

  const select = (item: PlanItem) => {
    setSetlistOpen(false);
    void navigate({
      to: "/services/$serviceTypeId/plans/$planId/$view",
      params: { serviceTypeId, planId, view: "practice" },
      search: (search) => ({ ...search, item: item.id }),
      replace: true,
    });
  };
  const stepTo = (target: PlanItem | null) => () => {
    if (target !== null) {
      select(target);
    }
  };
  useHotkey(practiceBinding("practice.next"), stepTo(next), {
    enabled: next !== null,
    ignoreInputs: true,
  });
  useHotkey(practiceBinding("practice.previous"), stepTo(previous), {
    enabled: previous !== null,
    ignoreInputs: true,
  });

  if (itemsQuery.isPending) {
    return <PracticeSkeleton />;
  }
  if (itemsQuery.isError && items.length === 0) {
    return (
      <QueryDataBoundary query={itemsQuery} title="Couldn't load the plan">
        {null}
      </QueryDataBoundary>
    );
  }
  if (current === null) {
    return <EmptyPlan />;
  }

  const position = stepPosition(items, current);
  const intentFor = (target: PlanItem | null) =>
    target?.song === null || target?.song === undefined
      ? null
      : getIntentProps(target.song.id);
  const setlist = (
    <PracticeSetlist items={items} currentId={current.id} onSelect={select} />
  );

  return (
    <div className="flex min-h-0 flex-1 gap-8">
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto overscroll-contain pb-4 max-lg:hidden">
        {setlist}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PracticeStage
          key={current.id}
          serviceTypeId={serviceTypeId}
          planId={planId}
          item={current}
          files={files}
          filesLoading={filesLoading}
          navigation={
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden"
                aria-label="Open the setlist"
                onClick={() => {
                  setSetlistOpen(true);
                }}
              >
                <ListMusic />
                {position === null ? null : (
                  <span className="tabular-nums">
                    {position.position}/{position.total}
                  </span>
                )}
              </Button>
              {position === null ? null : (
                <span className="text-muted-foreground px-1 text-xs tabular-nums max-lg:hidden">
                  {position.position} of {position.total}
                </span>
              )}
              <StepButton
                direction="previous"
                target={previous}
                onSelect={select}
                intentProps={intentFor(previous)}
              />
              <StepButton
                direction="next"
                target={next}
                onSelect={select}
                intentProps={intentFor(next)}
              />
            </div>
          }
        />
      </div>
      <Drawer open={setlistOpen} onOpenChange={setSetlistOpen} showSwipeHandle>
        <DrawerContent className="h-[min(40rem,calc(100dvh-5rem))] lg:hidden">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-left">Setlist</DrawerTitle>
            <DrawerDescription className="sr-only">
              Choose a song or item to practice.
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
            {setlist}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
};
