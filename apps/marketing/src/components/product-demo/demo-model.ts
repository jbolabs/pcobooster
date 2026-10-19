import { PLAN_DAY_UTC, initialAssignments, people, teams } from "./fixtures";
import type {
  DemoAssignment,
  DemoPerson,
  DemoPosition,
  DemoTeam,
  SlotStatus,
} from "./fixtures";
import { createStore } from "./store";

// A simplified, illustrative stand-in for the product's recommendation score:
// rested people who haven't served often rank highest, and the best candidate
// for a position reads 100, as in the product.
const RECENT_WINDOW_WEEKS = 8;
const FULL_REST_WEEKS = 4;
const HEAVY_LOAD_SERVICES = 4;
const REST_WEIGHT = 60;
const LOAD_WEIGHT = 40;
const ALSO_ON_PLAN_PENALTY = 25;
const BEST_SCORE = 100;
const DAYS_PER_WEEK = 7;
const REHEARSAL_DAYS_BEFORE_SUNDAY = 3;
/** Days of history shown on each side of the plan, as in the product. */
export const HISTORY_HALF_RANGE_DAYS = 28;
const MS_PER_DAY = 86_400_000;

export type Assignments = Readonly<Record<string, readonly DemoAssignment[]>>;
/** Slots per position (filled plus open), which a leader can raise or lower. */
export type SlotTotals = Readonly<Record<string, number>>;

export type CandidateState =
  | "available"
  | "confirmed"
  | "pending"
  | "blocked"
  | "declined";

export interface Candidate {
  readonly person: DemoPerson;
  readonly state: CandidateState;
  readonly score: number | null;
  readonly reasons: readonly string[];
  readonly alsoOnPlan: readonly string[];
}

const peopleById = new Map(people.map((entry) => [entry.id, entry]));
const positionsById = new Map(
  teams.flatMap((team) =>
    team.positions.map((position) => [position.id, { position, team }] as const)
  )
);

export const findPerson = (personId: string): DemoPerson | undefined =>
  peopleById.get(personId);

export const findPosition = (
  positionId: string
): { position: DemoPosition; team: DemoTeam } | undefined =>
  positionsById.get(positionId);

export const fullName = (entry: DemoPerson): string =>
  `${entry.firstName} ${entry.lastName}`;

export const initials = (entry: DemoPerson): string =>
  `${entry.firstName[0] ?? ""}${entry.lastName[0] ?? ""}`;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The plan day plus `offset` days, as a UTC date (the replica has no time zones). */
const dayAt = (offset: number): Date =>
  new Date(PLAN_DAY_UTC + offset * MS_PER_DAY);

/** "Sep 13": the date `offset` days from the plan. */
export const monthDayLabel = (offset: number): string => {
  const day = dayAt(offset);
  return `${MONTHS[day.getUTCMonth()] ?? ""} ${day.getUTCDate()}`;
};

/** "Sun, Sep 13". */
export const weekdayMonthDayLabel = (offset: number): string =>
  `${WEEKDAYS[dayAt(offset).getUTCDay()] ?? ""}, ${monthDayLabel(offset)}`;

/** "3 days before", "This plan", "the next day". */
export const distanceFromPlan = (offset: number): string => {
  if (offset === 0) {
    return "This plan";
  }
  const count = Math.abs(offset);
  const days = `${count} day${count === 1 ? "" : "s"}`;
  return offset < 0 ? `${days} before` : `${days} after`;
};

export interface DayEntry {
  readonly positionId: string;
  readonly rehearsal: boolean;
  readonly status: SlotStatus | null;
}

export type DayKind = "service" | "rehearsal" | "free";

export interface HistoryDay {
  /** Days from the plan: negative before it, 0 for the plan's own day. */
  readonly offset: number;
  readonly kind: DayKind;
  readonly status: SlotStatus | null;
  readonly entries: readonly DayEntry[];
}

const serviceStatus = (services: readonly DayEntry[]): SlotStatus | null => {
  if (services.length === 0) {
    return null;
  }
  return services.every((item) => item.status === "confirmed")
    ? "confirmed"
    : "pending";
};

/** Every day around the plan with what this person serves or rehearses on it. */
export const historyDays = (
  entry: DemoPerson,
  assignments: Assignments
): HistoryDay[] => {
  const byOffset = new Map<number, DayEntry[]>();
  const add = (offset: number, dayEntry: DayEntry) => {
    if (Math.abs(offset) <= HISTORY_HALF_RANGE_DAYS) {
      byOffset.set(offset, [...(byOffset.get(offset) ?? []), dayEntry]);
    }
  };
  for (const item of entry.served) {
    const sunday = -item.weeksAgo * DAYS_PER_WEEK;
    add(
      item.rehearsal === true ? sunday - REHEARSAL_DAYS_BEFORE_SUNDAY : sunday,
      {
        positionId: item.positionId,
        rehearsal: item.rehearsal === true,
        status: item.rehearsal === true ? null : "confirmed",
      }
    );
  }
  for (const item of entry.upcoming) {
    add(item.weeksAhead * DAYS_PER_WEEK, {
      positionId: item.positionId,
      rehearsal: false,
      status: item.status,
    });
  }
  for (const [positionId, slots] of Object.entries(assignments)) {
    const slot = slots.find((candidate) => candidate.personId === entry.id);
    if (slot !== undefined) {
      add(0, { positionId, rehearsal: false, status: slot.status });
    }
  }
  const days: HistoryDay[] = [];
  for (
    let offset = -HISTORY_HALF_RANGE_DAYS;
    offset <= HISTORY_HALF_RANGE_DAYS;
    offset += 1
  ) {
    const entries = byOffset.get(offset) ?? [];
    const services = entries.filter((item) => !item.rehearsal);
    let kind: DayKind = "free";
    if (entries.length > 0) {
      kind = services.length === 0 ? "rehearsal" : "service";
    }
    days.push({
      offset,
      kind,
      status: serviceStatus(services),
      entries,
    });
  }
  return days;
};

/** The few schedule facts a leader weighs: when they last served and serve next. */
export const scheduleFacts = (entry: DemoPerson): string[] => {
  const pastWeeks: number[] = [];
  for (const item of entry.served) {
    if (item.rehearsal !== true) {
      pastWeeks.push(item.weeksAgo);
    }
  }
  const facts: string[] = [];
  facts.push(
    pastWeeks.length === 0
      ? "No recent services"
      : `Last served ${monthDayLabel(-Math.min(...pastWeeks) * DAYS_PER_WEEK)}`
  );
  const nextWeeks = entry.upcoming.map((item) => item.weeksAhead);
  if (nextWeeks.length > 0) {
    facts.push(
      `Next on ${monthDayLabel(Math.min(...nextWeeks) * DAYS_PER_WEEK)}`
    );
  }
  return facts;
};

export const weeksAgoLabel = (weeksAgo: number): string => {
  if (weeksAgo === 1) {
    return "Last week";
  }
  return `${weeksAgo} weeks ago`;
};

const lastServedWeeksAgo = (entry: DemoPerson): number | null => {
  const services = entry.served.filter((item) => item.rehearsal !== true);
  if (services.length === 0) {
    return null;
  }
  return Math.min(...services.map((item) => item.weeksAgo));
};

const recentServiceCount = (entry: DemoPerson): number => {
  const recentWeeks = new Set<number>();
  for (const item of entry.served) {
    if (item.rehearsal !== true && item.weeksAgo <= RECENT_WINDOW_WEEKS) {
      recentWeeks.add(item.weeksAgo);
    }
  }
  return recentWeeks.size;
};

const rawScoreFor = (entry: DemoPerson, alsoOnPlan: boolean): number => {
  const last = lastServedWeeksAgo(entry);
  const rest =
    last === null ? 1 : Math.min(last - 1, FULL_REST_WEEKS) / FULL_REST_WEEKS;
  const load = Math.max(0, 1 - recentServiceCount(entry) / HEAVY_LOAD_SERVICES);
  const score = Math.round(REST_WEIGHT * rest + LOAD_WEIGHT * load);
  return alsoOnPlan ? Math.max(0, score - ALSO_ON_PLAN_PENALTY) : score;
};

const reasonsFor = (
  entry: DemoPerson,
  alsoOnPlan: readonly string[]
): string[] => {
  const last = lastServedWeeksAgo(entry);
  const recent = recentServiceCount(entry);
  const reasons = [
    last === null
      ? "No serving in the last few months"
      : `Last served ${weeksAgoLabel(last).toLowerCase()}`,
    `Served ${recent} of the last ${RECENT_WINDOW_WEEKS} weeks`,
  ];
  if (alsoOnPlan.length > 0) {
    reasons.push(`Already on this plan for ${alsoOnPlan.join(", ")}`);
  }
  return reasons;
};

const assignedPositionNames = (
  assignments: Assignments,
  personId: string,
  exceptPositionId: string
): string[] =>
  Object.entries(assignments).flatMap(([positionId, slots]) => {
    const name = findPosition(positionId)?.position.name;
    const isElsewhere =
      positionId !== exceptPositionId &&
      slots.some((slot) => slot.personId === personId);
    return isElsewhere && name !== undefined ? [name] : [];
  });

const stateFor = (
  entry: DemoPerson,
  positionId: string,
  assignment: DemoAssignment | undefined
): CandidateState => {
  if (assignment !== undefined) {
    return assignment.status;
  }
  if (entry.blockedOut === true) {
    return "blocked";
  }
  if (entry.declined !== undefined && entry.positionIds[0] === positionId) {
    return "declined";
  }
  return "available";
};

const stateRank: Record<CandidateState, number> = {
  confirmed: 0,
  pending: 1,
  available: 2,
  declined: 3,
  blocked: 4,
};

export const candidatesFor = (
  positionId: string,
  assignments: Assignments
): Candidate[] => {
  const slots = assignments[positionId] ?? [];
  const rows = people.flatMap((entry) => {
    if (!entry.positionIds.includes(positionId)) {
      return [];
    }
    const state = stateFor(
      entry,
      positionId,
      slots.find((slot) => slot.personId === entry.id)
    );
    const alsoOnPlan = assignedPositionNames(assignments, entry.id, positionId);
    return [
      {
        person: entry,
        state,
        raw: rawScoreFor(entry, alsoOnPlan.length > 0),
        reasons: reasonsFor(entry, alsoOnPlan),
        alsoOnPlan,
      },
    ];
  });
  const rankable = rows.filter(
    (row) => row.state === "available" || row.state === "declined"
  );
  const best = Math.max(1, ...rankable.map((row) => row.raw));
  return rows
    .map(({ raw, ...row }) => ({
      ...row,
      // Only people who could still be added are ranked against each other.
      score: rankable.some((item) => item.person.id === row.person.id)
        ? Math.round((raw / best) * BEST_SCORE)
        : null,
    }))
    .toSorted(
      (a, b) =>
        stateRank[a.state] - stateRank[b.state] ||
        (b.score ?? -1) - (a.score ?? -1)
    );
};

export interface SlotSummary {
  readonly filled: number;
  readonly open: number;
  readonly pending: number;
  readonly total: number;
}

export const slotSummary = (
  position: DemoPosition,
  assignments: Assignments,
  totals: SlotTotals
): SlotSummary => {
  const slots = assignments[position.id] ?? [];
  const total = Math.max(slots.length, totals[position.id] ?? position.slots);
  return {
    filled: slots.length,
    open: total - slots.length,
    pending: slots.filter((slot) => slot.status === "pending").length,
    total,
  };
};

export const teamOpenCount = (
  team: DemoTeam,
  assignments: Assignments,
  totals: SlotTotals
) =>
  team.positions.reduce(
    (count, position) =>
      count + slotSummary(position, assignments, totals).open,
    0
  );

interface PlanState {
  readonly assignments: Assignments;
  readonly totals: SlotTotals;
}

const initialTotals: SlotTotals = Object.fromEntries(
  teams.flatMap((team) =>
    team.positions.map((position) => [position.id, position.slots] as const)
  )
);

const initialPlanState: PlanState = {
  assignments: initialAssignments,
  totals: initialTotals,
};

// Module-level stores so every replica on the page (hero, lineup, history)
// reflects the same visitor edits, the way the real app shares its cache.
const planStore = createStore<PlanState>(initialPlanState);

export const useAssignments = (): Assignments =>
  planStore.use((state) => state.assignments);

export const useSlotTotals = (): SlotTotals =>
  planStore.use((state) => state.totals);

const setAssignments = (assignments: Assignments) => {
  planStore.set({ ...planStore.get(), assignments });
};

export const addAssignment = (positionId: string, personId: string) => {
  const current = planStore.get().assignments;
  const slots = current[positionId] ?? [];
  if (slots.some((slot) => slot.personId === personId)) {
    return;
  }
  setAssignments({
    ...current,
    [positionId]: [...slots, { personId, status: "pending" }],
  });
};

export const setAssignmentStatus = (
  positionId: string,
  personId: string,
  status: SlotStatus
) => {
  const current = planStore.get().assignments;
  setAssignments({
    ...current,
    [positionId]: (current[positionId] ?? []).map((slot) =>
      slot.personId === personId ? { ...slot, status } : slot
    ),
  });
};

export const removeAssignment = (positionId: string, personId: string) => {
  const current = planStore.get().assignments;
  setAssignments({
    ...current,
    [positionId]: (current[positionId] ?? []).filter(
      (slot) => slot.personId !== personId
    ),
  });
};

/** One more or one fewer open slot, never below the people already on it. */
export const adjustOpenSlots = (
  position: DemoPosition,
  direction: "add" | "remove"
) => {
  const state = planStore.get();
  const { open, total } = slotSummary(
    position,
    state.assignments,
    state.totals
  );
  if (direction === "remove" && open === 0) {
    return;
  }
  planStore.set({
    ...state,
    totals: {
      ...state.totals,
      [position.id]: direction === "add" ? total + 1 : total - 1,
    },
  });
};

export const resetAssignments = () => {
  planStore.set(initialPlanState);
};

/** The plan's own views, in the order the product lists them. */
export type PlanView =
  | "overview"
  | "assign"
  | "lineup"
  | "plan"
  | "times"
  | "practice";
export type DemoView = PlanView | "services" | "people" | "songs";

export const isPlanView = (view: DemoView): view is PlanView =>
  view !== "services" && view !== "people" && view !== "songs";

export interface DemoRoute {
  readonly view: DemoView;
  readonly positionId: string;
  /** The song whose chord chart is open in Songs; null shows the library. */
  readonly songId: string | null;
}

const routeStore = createStore<DemoRoute>({
  view: "assign",
  positionId: "acoustic",
  songId: null,
});

export const useDemoRoute = (): DemoRoute => routeStore.use((state) => state);

export const navigateDemo = (next: Partial<DemoRoute>) => {
  routeStore.set({ ...routeStore.get(), ...next });
};

/** Opens a view in the page's full replica and scrolls it into sight. */
export const openInDemo = (view: DemoView, demoAnchorId: string) => {
  navigateDemo({ view, songId: null });
  document
    .querySelector(`#${demoAnchorId}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
};
