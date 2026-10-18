import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { getInitials } from "@pcobooster/planning-center-models/initials";
import { getSchedulingNotificationState } from "@pcobooster/planning-center-models/scheduling-notifications";
import type { SlotRef } from "@pcobooster/planning-center-models/scheduling-notifications";
import type {
  FilledPositionPerson,
  PlanTime,
  TeamPosition,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Mail,
  Plus,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, SubmitEvent as ReactSubmitEvent } from "react";

import { AvatarStatus } from "@/components/schedule/avatar-status";
import {
  collectPlanAssignments,
  otherPlanAssignments,
} from "@/components/schedule/plan-assignments";
import type { PlanAssignment } from "@/components/schedule/plan-assignments";
import { PlanPersonEditDialog } from "@/components/schedule/plan-person-edit-dialog";
import { getPlanPersonStatusValue } from "@/components/schedule/plan-person-status";
import {
  PositionPickerIcon,
  TeamPickerIcon,
} from "@/components/schedule/position-picker-icon";
import { UnsentNotificationMark } from "@/components/schedule/scheduling-notification-mark";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DragHandle } from "@/components/ui/drag-handle";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HoverLabel } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Item } from "@/components/ui/item";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { useLineupColumnOrder } from "@/hooks/use-lineup-column-order";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRevealOnLoad } from "@/hooks/use-reveal-on-load";
import { isSavedPlanPersonId } from "@/hooks/use-schedule-cache-optimism";
import {
  applyLineupColumnOrder,
  reorderLineupColumnIds,
} from "@/lib/lineup-column-order";
import { ReplayMask } from "@/lib/replay-mask";
import { openSlotCount } from "@/lib/schedule/open-positions";
import {
  sortableDropAnimation,
  sortableMotion,
  sortableTransition,
} from "@/lib/sortable-motion";
import { cn } from "@/lib/utils";

/**
 * `row` lays teams side by side in one row that scrolls sideways (Lineup);
 * `stack` puts them in one column (Assign's position list, and phones).
 */
export type TeamRosterLayout = "row" | "stack";

type AddPosition = (
  team: { teamId: string; teamName: string },
  positionName: string
) => SlotRef | null;

interface SelectedSlot {
  teamId: string | null;
  positionId: string | null;
}

/** What the roster needs from the plan, shared by every panel and row. */
interface RosterContext {
  assignments: ReadonlyMap<string, PlanAssignment[]>;
  serviceTypeId: string | null;
  planId: string | null;
  seriesId: string | null;
  planTimes: PlanTime[];
  selected: SelectedSlot | null;
  /**
   * `edit` opens a person's assignment; `select` opens their position, for
   * lists whose selected position already shows its people beside it.
   */
  personAction: "edit" | "select";
  onSelectPosition: (slot: SlotRef) => void;
  getSlotIntentProps?: GetIntentPrefetchProps<SlotRef>;
  onAddPosition?: AddPosition;
}

const layoutClassNames = {
  /** A sideways row of tall columns is hard to use on a phone, so phones stack them. */
  row: "flex flex-col gap-3 pt-1 md:flex-row md:items-start md:*:w-80 md:*:shrink-0",
  stack: "flex flex-col gap-3",
} satisfies Record<TeamRosterLayout, string>;
const teamPanelClassName =
  "bg-background text-foreground shadow-xs ring-foreground/5 dark:ring-foreground/10 flex flex-col rounded-xl ring-1";
const teamHeaderClassName =
  "group/team-header bg-muted/40 flex items-stretch gap-0.5 rounded-t-xl px-1.5 py-1.5";
const rosterClassName =
  "border-border/60 divide-border/60 flex flex-col divide-y border-t";
const rosterPositionClassName =
  "flex flex-col px-1.5 py-1.5 last:rounded-b-xl data-active:bg-muted";
/** People sit under the position's name, past its icon. */
const rosterPeopleClassName = "flex min-w-0 flex-col pl-6";
const rosterRowClassName = "min-h-10";

const getStatusDotStatus = (
  person: FilledPositionPerson
): "confirmed" | "scheduled" | "declined" => {
  const status = getPlanPersonStatusValue(person);
  return status === "declined" ? "declined" : status;
};

const isUnsent = (person: FilledPositionPerson) =>
  getSchedulingNotificationState(person.notification) === "unsent";

const STATUS_LABELS = {
  scheduled: "Pending",
  declined: "Declined",
} as const;

const ASSIGNMENT_STATUS_LABELS = {
  confirmed: "confirmed",
  scheduled: "pending",
} as const;

const describeOtherAssignments = (assignments: readonly PlanAssignment[]) =>
  `Also on ${assignments
    .map(
      ({ positionName, status }) =>
        `${positionName} · ${ASSIGNMENT_STATUS_LABELS[status]}`
    )
    .join(", ")}`;

const PersonRowContent = ({
  person,
  otherAssignments,
}: {
  person: FilledPositionPerson;
  otherAssignments: readonly PlanAssignment[];
}) => {
  const status = getStatusDotStatus(person);
  const avatar = (
    <Avatar>
      <AvatarImage src={person.photoThumbnailUrl ?? undefined} alt="" />
      <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
    </Avatar>
  );

  return (
    <>
      {otherAssignments.length > 0 ? (
        <HoverLabel
          label={describeOtherAssignments(otherAssignments)}
          side="bottom"
          render={<span className="inline-flex shrink-0 rounded-full" />}
        >
          <AvatarStatus status={status} alsoScheduled>
            {avatar}
          </AvatarStatus>
        </HoverLabel>
      ) : (
        <AvatarStatus status={status}>{avatar}</AvatarStatus>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          status === "declined" && "text-muted-foreground line-through"
        )}
      >
        <ReplayMask>{person.name}</ReplayMask>
      </span>
      {isUnsent(person) ? <UnsentNotificationMark /> : null}
    </>
  );
};

const describePerson = (
  person: FilledPositionPerson,
  otherAssignments: readonly PlanAssignment[]
) => {
  const status = getStatusDotStatus(person);
  return [
    status === "confirmed" ? undefined : STATUS_LABELS[status].toLowerCase(),
    otherAssignments.length > 0
      ? describeOtherAssignments(otherAssignments).toLowerCase()
      : undefined,
    isUnsent(person) ? "not notified yet" : undefined,
  ].filter(Boolean);
};

const EditablePersonRow = ({
  context,
  person,
  otherAssignments,
  slot,
}: {
  context: RosterContext;
  person: FilledPositionPerson;
  otherAssignments: readonly PlanAssignment[];
  slot: SlotRef;
}) => {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <Item
        size="row"
        className={rosterRowClassName}
        render={
          <button
            type="button"
            // Someone just assigned can't be edited until their assign lands.
            disabled={!isSavedPlanPersonId(person.planPersonId)}
            aria-label={[
              "Edit person assignment",
              ...describePerson(person, otherAssignments),
            ].join(", ")}
          />
        }
        onClick={() => {
          setEditOpen(true);
        }}
      >
        <PersonRowContent person={person} otherAssignments={otherAssignments} />
      </Item>
      <PlanPersonEditDialog
        person={person}
        teamName={slot.teamName}
        positionName={slot.positionName}
        planTimes={context.planTimes}
        open={editOpen}
        onOpenChange={setEditOpen}
        serviceTypeId={context.serviceTypeId}
        planId={context.planId}
        seriesId={context.seriesId}
        teamId={slot.teamId}
        positionId={slot.positionId}
      />
    </>
  );
};

const PositionRows = ({
  context,
  teamId,
  teamName,
  position,
}: {
  context: RosterContext;
  teamId: string;
  teamName: string;
  position: TeamPosition;
}) => {
  const people = position.filledPeople ?? [];
  const openCount = openSlotCount(position);
  const isTemporaryPosition =
    !!position.source && position.source !== "team_position";
  const active =
    context.selected?.teamId === teamId &&
    context.selected.positionId === position.id;
  const rowRef = useRef<HTMLLIElement>(null);
  const slot: SlotRef = {
    teamId,
    teamName,
    positionId: position.id,
    positionName: position.name,
    source: position.source,
  };
  const selectProps = {
    ...context.getSlotIntentProps?.(slot),
    onClick: () => {
      context.onSelectPosition(slot);
    },
  };
  const selectLabel =
    context.personAction === "select"
      ? position.name
      : `Find people for ${position.name}`;

  // Keep the selected position in view when it changes or the list first opens.
  useEffect(() => {
    if (active) {
      rowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <li
      ref={rowRef}
      className={rosterPositionClassName}
      data-active={active || undefined}
      aria-current={active || undefined}
    >
      <Item
        size="row"
        className="min-h-9"
        render={
          <button type="button" aria-label={selectLabel} {...selectProps} />
        }
      >
        <PositionPickerIcon positionName={position.name} teamName={teamName} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-medium",
            isTemporaryPosition && "italic"
          )}
        >
          {position.name}
        </span>
        <ChevronRight
          className="text-muted-foreground size-3.5 shrink-0 opacity-0 group-hover/item:opacity-60 group-focus-visible/item:opacity-60"
          aria-hidden
        />
      </Item>
      <ul className={rosterPeopleClassName}>
        {people.map((person) => {
          const otherAssignments = otherPlanAssignments(
            context.assignments,
            person,
            { teamId, positionId: position.id }
          );
          return (
            <li key={`${person.id}-${person.rawStatus}`}>
              {context.personAction === "edit" ? (
                <EditablePersonRow
                  context={context}
                  person={person}
                  otherAssignments={otherAssignments}
                  slot={slot}
                />
              ) : (
                <Item
                  size="row"
                  className={rosterRowClassName}
                  render={
                    <button
                      type="button"
                      aria-label={[
                        `${position.name}: person`,
                        ...describePerson(person, otherAssignments),
                      ].join(", ")}
                      {...selectProps}
                    />
                  }
                >
                  <PersonRowContent
                    person={person}
                    otherAssignments={otherAssignments}
                  />
                </Item>
              )}
            </li>
          );
        })}
        {openCount > 0 || people.length === 0 ? (
          <li>
            <Item
              size="row"
              className={rosterRowClassName}
              render={
                <button
                  type="button"
                  aria-label={
                    openCount > 0
                      ? `Fill ${openCount} open ${position.name} ${openCount === 1 ? "slot" : "slots"}`
                      : selectLabel
                  }
                  {...selectProps}
                />
              }
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed",
                  openCount > 0
                    ? "border-status-declined/50 text-status-declined"
                    : "border-muted-foreground/40 text-muted-foreground"
                )}
              >
                <UserPlus className="size-3.5" aria-hidden />
              </span>
              <span
                className={cn(
                  "text-sm tabular-nums",
                  openCount > 0
                    ? "text-status-declined font-medium"
                    : "text-muted-foreground"
                )}
              >
                {openCount > 1 ? `${openCount} open` : null}
                {openCount === 1 ? "Open" : null}
                {openCount === 0 ? "No one yet" : null}
              </span>
            </Item>
          </li>
        ) : null}
      </ul>
    </li>
  );
};

const AddPositionRow = ({
  group,
  onAddPosition,
  onSelectPosition,
}: {
  group: TeamPositionGroup;
  onAddPosition: AddPosition;
  onSelectPosition: (slot: SlotRef) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [positionName, setPositionName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const handleSubmit = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = positionName.trim();
    if (!trimmedName) {
      return;
    }
    const slot = onAddPosition(
      { teamId: group.teamId, teamName: group.teamName },
      trimmedName
    );
    if (!slot) {
      return;
    }
    setPositionName("");
    setOpen(false);
    onSelectPosition(slot);
  };

  return (
    <li className="px-1.5 py-1 last:rounded-b-xl">
      <ResponsivePopover open={open} onOpenChange={setOpen}>
        <ResponsivePopoverTrigger
          render={
            <Item
              size="row"
              className="text-muted-foreground min-h-9"
              render={
                <button
                  type="button"
                  aria-label={`Add ${group.teamName} position`}
                />
              }
            />
          }
        >
          <Plus className="size-4" aria-hidden />
          <span className="text-xs">Add position</span>
        </ResponsivePopoverTrigger>
        <ResponsivePopoverContent
          title="Add position"
          align="start"
          side="bottom"
          sideOffset={6}
          className="w-[min(18rem,calc(100vw-2rem))]"
        >
          <form className="flex gap-2 p-3" onSubmit={handleSubmit}>
            <Input
              ref={inputRef}
              value={positionName}
              onChange={(event) => {
                setPositionName(event.target.value);
              }}
              placeholder="Position name"
              aria-label={`New ${group.teamName} position`}
              className="h-8"
            />
            <Button type="submit" size="sm" disabled={!positionName.trim()}>
              Add
            </Button>
          </form>
        </ResponsivePopoverContent>
      </ResponsivePopover>
    </li>
  );
};

const TeamPanel = ({
  group,
  context,
  collapsed,
  onToggle,
  dragHandleAttributes,
  dragHandleListeners,
}: {
  group: TeamPositionGroup;
  context: RosterContext;
  collapsed: boolean;
  onToggle: (teamId: string) => void;
  dragHandleAttributes?: ReturnType<typeof useSortable>["attributes"];
  dragHandleListeners?: ReturnType<typeof useSortable>["listeners"];
}) => {
  const unsentCount = group.positions.reduce(
    (sum, position) =>
      sum + (position.filledPeople ?? []).filter(isUnsent).length,
    0
  );
  const openCount = group.positions.reduce(
    (sum, position) => sum + openSlotCount(position),
    0
  );
  const open = !collapsed;
  const { onAddPosition: handleAddPosition, onSelectPosition: handleSelect } =
    context;
  // A collapsed team still shows its selected position, so the selection never hides.
  const selectedWhileCollapsed = collapsed
    ? group.positions.find(
        (position) =>
          context.selected?.teamId === group.teamId &&
          context.selected.positionId === position.id
      )
    : undefined;
  const renderPosition = (position: TeamPosition) => (
    <PositionRows
      key={position.id}
      context={context}
      teamId={group.teamId}
      teamName={group.teamName}
      position={position}
    />
  );

  return (
    <section className={teamPanelClassName}>
      <Collapsible
        open={open}
        onOpenChange={() => {
          onToggle(group.teamId);
        }}
      >
        <div
          className={cn(
            teamHeaderClassName,
            // Nothing below a collapsed header, so it rounds the panel's bottom too.
            collapsed && !selectedWhileCollapsed && "rounded-b-xl"
          )}
        >
          {dragHandleListeners ? (
            <DragHandle
              size="sm"
              {...dragHandleAttributes}
              {...dragHandleListeners}
              aria-label={`Reorder ${group.teamName}`}
            />
          ) : null}
          <CollapsibleTrigger
            nativeButton
            render={
              <Item
                size="row"
                className="min-w-0 flex-1"
                render={
                  <button type="button" aria-label={`${group.teamName} team`} />
                }
              />
            }
          >
            <TeamPickerIcon teamName={group.teamName} />
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
              {group.teamName}
            </h3>
            {collapsed && openCount > 0 ? (
              <span className="text-status-declined text-xs font-medium tabular-nums">
                {openCount} open
              </span>
            ) : null}
            {unsentCount > 0 ? (
              <HoverLabel
                label={`${unsentCount} not notified yet. Send the emails in Planning Center.`}
                side="bottom"
                render={
                  <Badge
                    variant="outline"
                    aria-label={`${unsentCount} not notified`}
                  />
                }
              >
                <Mail aria-hidden />
                {unsentCount}
              </HoverLabel>
            ) : null}
            <ChevronDown
              className={cn(
                "text-muted-foreground size-3.5 shrink-0 opacity-60",
                collapsed && "-rotate-90"
              )}
            />
          </CollapsibleTrigger>
        </div>
        {selectedWhileCollapsed ? (
          <ul className={rosterClassName}>
            {renderPosition(selectedWhileCollapsed)}
          </ul>
        ) : null}
        <CollapsibleContent>
          <ul className={rosterClassName}>
            {group.positions.map(renderPosition)}
            {handleAddPosition ? (
              <AddPositionRow
                group={group}
                onAddPosition={handleAddPosition}
                onSelectPosition={handleSelect}
              />
            ) : null}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
};

const SortableTeamPanel = ({
  isDragging,
  reorderDisabled,
  ...panelProps
}: Parameters<typeof TeamPanel>[0] & {
  isDragging: boolean;
  reorderDisabled: boolean;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: panelProps.group.teamId,
    disabled: reorderDisabled,
    transition: sortableTransition,
  });
  const motion = sortableMotion({ transform, transition });
  const style: CSSProperties & {
    "--sortable-transform": string;
    "--sortable-transition": string;
  } = {
    "--sortable-transform": motion.transform,
    "--sortable-transition": motion.transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "sortable-plan-item min-w-0",
        (isDragging || isSortableDragging) && "opacity-0"
      )}
    >
      <TeamPanel
        dragHandleAttributes={attributes}
        dragHandleListeners={listeners}
        {...panelProps}
      />
    </div>
  );
};

const TeamPanelOverlay = ({ group }: { group: TeamPositionGroup }) => (
  <section className={cn(teamPanelClassName, "bg-muted/80 shadow-2xl")}>
    <div className="flex items-center gap-2 px-3 py-2.5">
      <GripVertical className="text-muted-foreground size-4 shrink-0" />
      <h3 className="truncate text-sm font-semibold tracking-tight">
        {group.teamName}
      </h3>
    </div>
  </section>
);

const skeletonTeams = [
  { key: "a", title: "7rem", positions: [2, 1, 1, 1] },
  { key: "b", title: "5rem", positions: [1, 2, 1] },
  { key: "c", title: "8rem", positions: [1, 1] },
];
const skeletonWidths = ["8rem", "6rem", "9rem", "7rem"];

/** The team panels before anything loads. */
export const TeamRosterSkeleton = ({
  layout,
}: {
  layout: TeamRosterLayout;
}) => (
  <div className={layoutClassNames[layout]}>
    {skeletonTeams.map((team) => (
      <div key={team.key} className={teamPanelClassName}>
        <div className="flex h-12 items-center px-3.5">
          <Skeleton variant="text" className="h-3.5" width={team.title} />
        </div>
        <div className="border-border/60 divide-border/60 divide-y border-t">
          {team.positions.map((people, positionIndex) => (
            <div
              key={`${team.key}-${positionIndex}`}
              className="flex flex-col px-1.5 py-1.5"
            >
              <div className="flex h-9 items-center gap-2 px-1.5">
                <Skeleton variant="text" className="size-4" />
                <Skeleton variant="text" className="h-3 w-20" />
              </div>
              {Array.from({ length: people }, (_, personIndex) => (
                <div
                  key={personIndex}
                  className="flex h-10 items-center gap-2 pl-7.5"
                >
                  <Skeleton variant="round" className="size-8" />
                  <Skeleton
                    variant="text"
                    className="h-3"
                    width={
                      skeletonWidths[
                        (positionIndex + personIndex) % skeletonWidths.length
                      ]
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

interface TeamRosterProps {
  layout: TeamRosterLayout;
  groups: TeamPositionGroup[];
  isLoading: boolean;
  serviceTypeId: string | null;
  planId: string | null;
  /** Needed to edit people, so only when `personAction` is `edit`. */
  seriesId?: string | null;
  planTimes?: PlanTime[];
  collapsedTeams: Record<string, boolean>;
  onToggleTeam: (teamId: string) => void;
  selected?: SelectedSlot | null;
  personAction: RosterContext["personAction"];
  onSelectPosition: (slot: SlotRef) => void;
  getSlotIntentProps?: GetIntentPrefetchProps<SlotRef>;
  onAddPosition?: AddPosition;
  /** Drag teams into the service type's saved order. Off on phones regardless. */
  reorderable?: boolean;
}

const NO_PLAN_TIMES: PlanTime[] = [];

/** A plan's teams as rosters: each position, then the people on it. */
export const TeamRoster = ({
  layout,
  groups,
  isLoading,
  serviceTypeId,
  planId,
  seriesId = null,
  planTimes = NO_PLAN_TIMES,
  collapsedTeams,
  onToggleTeam,
  selected = null,
  personAction,
  onSelectPosition,
  getSlotIntentProps,
  onAddPosition,
  reorderable = true,
}: TeamRosterProps) => {
  const [columnOrderByServiceType, updateColumnOrder] = useLineupColumnOrder();
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const revealClassName = useRevealOnLoad(isLoading);
  const orderedGroups = useMemo(() => {
    if (serviceTypeId === null) {
      return groups;
    }
    return applyLineupColumnOrder(
      groups,
      columnOrderByServiceType[serviceTypeId]
    );
  }, [columnOrderByServiceType, groups, serviceTypeId]);
  const assignments = useMemo(() => collectPlanAssignments(groups), [groups]);
  const activeGroup =
    orderedGroups.find((group) => group.teamId === activeTeamId) ?? null;
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 160, tolerance: 10 },
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTeamId(null);

    if (serviceTypeId === null) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!(overId !== null && overId !== "") || activeId === overId) {
      return;
    }

    const currentOrder = orderedGroups.map((group) => group.teamId);
    const nextOrder = reorderLineupColumnIds(currentOrder, activeId, overId);
    if (
      nextOrder.length === currentOrder.length &&
      nextOrder.every((teamId, index) => teamId === currentOrder[index])
    ) {
      return;
    }

    updateColumnOrder((current) => ({
      ...current,
      [serviceTypeId]: nextOrder,
    }));
  };

  if (isLoading) {
    return <TeamRosterSkeleton layout={layout} />;
  }

  if (groups.length === 0) {
    return (
      <Empty className="min-h-[16rem]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays />
          </EmptyMedia>
          <EmptyTitle>No slots found</EmptyTitle>
          <EmptyDescription>
            This plan has no team positions yet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const context: RosterContext = {
    assignments,
    serviceTypeId,
    planId,
    seriesId,
    planTimes,
    selected,
    personAction,
    onSelectPosition,
    getSlotIntentProps,
    onAddPosition,
  };

  if (isMobile || !reorderable) {
    return (
      <div className={cn(layoutClassNames[layout], revealClassName)}>
        {orderedGroups.map((group) => (
          <TeamPanel
            key={group.teamId}
            group={group}
            context={context}
            collapsed={collapsedTeams[group.teamId] ?? false}
            onToggle={onToggleTeam}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("relative", revealClassName)}>
      <DndContext
        collisionDetection={closestCenter}
        sensors={sensors}
        onDragStart={(event: DragStartEvent) => {
          setActiveTeamId(String(event.active.id));
        }}
        onDragCancel={() => {
          setActiveTeamId(null);
        }}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={orderedGroups.map((group) => group.teamId)}
          strategy={
            layout === "row"
              ? horizontalListSortingStrategy
              : verticalListSortingStrategy
          }
        >
          <div className={layoutClassNames[layout]}>
            {orderedGroups.map((group) => (
              <SortableTeamPanel
                key={group.teamId}
                group={group}
                context={context}
                collapsed={collapsedTeams[group.teamId] ?? false}
                onToggle={onToggleTeam}
                isDragging={activeTeamId === group.teamId}
                reorderDisabled={serviceTypeId === null}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay zIndex={60} dropAnimation={sortableDropAnimation}>
          {activeGroup ? <TeamPanelOverlay group={activeGroup} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};
