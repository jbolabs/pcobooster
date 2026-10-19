import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  ListMusic,
  Users,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { DemoButton } from "../ui/demo-control";
import {
  navigateDemo,
  slotSummary,
  useAssignments,
  useSlotTotals,
} from "./demo-model";
import type { PlanView } from "./demo-model";
import { teams, times } from "./fixtures";
import type { DemoPlanItem, DemoPosition, DemoTeam } from "./fixtures";
import { usePlanItems } from "./plan-model";

import styles from "./product-demo.module.css";

interface Check {
  readonly id: string;
  readonly done: boolean;
  readonly label: string;
  readonly view: PlanView;
}

interface TeamStaffing {
  readonly team: DemoTeam;
  readonly confirmed: number;
  readonly pending: number;
  readonly open: number;
}

interface OpenPosition {
  readonly team: DemoTeam;
  readonly position: DemoPosition;
  readonly open: number;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const share = (count: number, total: number) =>
  total === 0 ? "0%" : `${(count / total) * 100}%`;

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

interface PlanSummary {
  readonly songs: readonly DemoPlanItem[];
  readonly songsWithoutKey: number;
  /** "1:03:00": the service's length as the product writes it. */
  readonly serviceLength: string;
}

const usePlanSummary = (): PlanSummary => {
  const items = usePlanItems();
  const songs = items.filter((item) => item.kind === "song");
  const totalMinutes = Math.round(
    items.reduce((total, item) => total + item.seconds, 0) / SECONDS_PER_MINUTE
  );
  return {
    songs,
    songsWithoutKey: songs.filter((item) => item.songKey === undefined).length,
    serviceLength: `${Math.floor(totalMinutes / MINUTES_PER_HOUR)}:${String(totalMinutes % MINUTES_PER_HOUR).padStart(2, "0")}:00`,
  };
};
const serviceTimes = times.filter((time) => time.type === "service");
const rehearsals = times.filter((time) => time.type === "rehearsal");

const useStaffing = () => {
  const assignments = useAssignments();
  const totals = useSlotTotals();
  const byTeam: TeamStaffing[] = [];
  const openPositions: OpenPosition[] = [];
  for (const team of teams) {
    let confirmed = 0;
    let pending = 0;
    let open = 0;
    for (const position of team.positions) {
      const summary = slotSummary(position, assignments, totals);
      const slots = assignments[position.id] ?? [];
      const slotsConfirmed = slots.filter(
        (slot) => slot.status === "confirmed"
      ).length;
      confirmed += slotsConfirmed;
      pending += summary.filled - slotsConfirmed;
      open += summary.open;
      if (summary.open > 0) {
        openPositions.push({ team, position, open: summary.open });
      }
    }
    byTeam.push({ team, confirmed, pending, open });
  }
  const sum = (pick: (entry: TeamStaffing) => number) =>
    byTeam.reduce((total, entry) => total + pick(entry), 0);
  const confirmed = sum((entry) => entry.confirmed);
  const pending = sum((entry) => entry.pending);
  const open = sum((entry) => entry.open);
  return {
    confirmed,
    pending,
    open,
    total: confirmed + pending + open,
    byTeam,
    openPositions,
  };
};

type Staffing = ReturnType<typeof useStaffing>;

const buildChecks = (staffing: Staffing, summary: PlanSummary): Check[] => [
  staffing.open > 0
    ? {
        id: "positions",
        done: false,
        label: `${plural(staffing.open, "position needs", "positions need")} someone`,
        view: "assign",
      }
    : {
        id: "positions",
        done: true,
        label: "Every position is filled",
        view: "lineup",
      },
  staffing.pending > 0
    ? {
        id: "responses",
        done: false,
        label: `${plural(staffing.pending, "person hasn't", "people haven't")} responded`,
        view: "lineup",
      }
    : {
        id: "responses",
        done: true,
        label: "Everyone scheduled has confirmed",
        view: "lineup",
      },
  {
    id: "songs",
    done: true,
    label: `${plural(summary.songs.length, "song", "songs")} planned`,
    view: "plan",
  },
  summary.songsWithoutKey > 0
    ? {
        id: "keys",
        done: false,
        label: `${plural(summary.songsWithoutKey, "song has", "songs have")} no key`,
        view: "plan",
      }
    : {
        id: "keys",
        done: true,
        label: "Every song has a key",
        view: "plan",
      },
  {
    id: "times",
    done: true,
    label: `${plural(serviceTimes.length, "service time", "service times")} and ${plural(rehearsals.length, "rehearsal", "rehearsals")}`,
    view: "times",
  },
];

const viewLabel: Record<PlanView, string> = {
  overview: "Overview",
  assign: "Assign",
  lineup: "Lineup",
  plan: "Plan",
  times: "Times",
  practice: "Practice",
};

const OverviewCard = ({
  icon,
  title,
  description,
  action,
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: PlanView;
  className?: string;
  children: ReactNode;
}) => (
  <section className={`${styles["overview-card"]} ${className ?? ""}`}>
    <header className={styles["overview-card-head"]}>
      <div>
        <h3>
          {icon}
          {title}
        </h3>
        <p>{description}</p>
      </div>
      {action === undefined ? null : (
        <DemoButton
          variant="ghost"
          onClick={() => {
            navigateDemo({ view: action });
          }}
        >
          {viewLabel[action]}
          <ChevronRight aria-hidden size={14} />
        </DemoButton>
      )}
    </header>
    {children}
  </section>
);

const FilledBar = ({
  confirmed,
  pending,
  total,
  size,
}: {
  confirmed: number;
  pending: number;
  total: number;
  size: "sm" | "md";
}) => {
  const shares: CSSProperties & {
    "--confirmed-share": string;
    "--pending-share": string;
  } = {
    "--confirmed-share": share(confirmed, total),
    "--pending-share": share(pending, total),
  };
  return (
    <span
      aria-hidden
      className={styles["filled-bar"]}
      data-size={size}
      style={shares}
    >
      <span data-tone="confirmed" />
      <span data-tone="pending" />
    </span>
  );
};

const ReadinessCard = ({
  staffing,
  summary,
}: {
  staffing: Staffing;
  summary: PlanSummary;
}) => {
  const checks = buildChecks(staffing, summary);
  const todo = checks.filter((check) => !check.done).length;
  let description = "Everything we can check looks ready.";
  if (todo > 0) {
    description =
      todo === 1 ? "1 thing left to do." : `${todo} things left to do.`;
  }
  return (
    <OverviewCard
      icon={<CircleCheck aria-hidden size={16} />}
      title="Readiness"
      description={description}
      className={styles["overview-wide"]}
    >
      <ul className={styles["readiness-list"]}>
        {checks.map((check) => (
          <li key={check.id}>
            <DemoButton
              variant="row"
              aria-label={`${check.label}. Open ${viewLabel[check.view]}`}
              onClick={() => {
                navigateDemo({ view: check.view });
              }}
            >
              {check.done ? (
                <CircleCheck
                  aria-hidden
                  size={16}
                  className={styles["check-done"]}
                />
              ) : (
                <CircleAlert
                  aria-hidden
                  size={16}
                  className={styles["check-todo"]}
                />
              )}
              <span
                className={`${styles.truncate} ${styles.grow}`}
                data-muted={check.done ? "" : undefined}
              >
                {check.label}
              </span>
              <ChevronRight
                aria-hidden
                size={16}
                className={styles["row-chevron"]}
              />
            </DemoButton>
          </li>
        ))}
      </ul>
    </OverviewCard>
  );
};

const PeopleCard = ({ staffing }: { staffing: Staffing }) => (
  <OverviewCard
    icon={<Users aria-hidden size={16} />}
    title="People"
    description={`${staffing.confirmed + staffing.pending} of ${staffing.total} slots filled`}
    action="lineup"
    className={styles["overview-tall"]}
  >
    <FilledBar
      confirmed={staffing.confirmed}
      pending={staffing.pending}
      total={staffing.total}
      size="md"
    />
    <p className={styles.legend}>
      <span data-tone="confirmed">{staffing.confirmed} confirmed</span>
      <span data-tone="pending">{staffing.pending} pending</span>
      <span data-tone="open">{staffing.open} open</span>
    </p>
    {staffing.openPositions.length > 0 ? (
      <>
        <h4 className={styles["overview-subhead"]}>Needs someone</h4>
        <ul>
          {staffing.openPositions.slice(0, 4).map((entry) => (
            <li key={entry.position.id}>
              <DemoButton
                variant="row"
                aria-label={`Assign ${entry.position.name} on ${entry.team.name}`}
                onClick={() => {
                  navigateDemo({
                    view: "assign",
                    positionId: entry.position.id,
                  });
                }}
              >
                <span className={`${styles.truncate} ${styles.grow}`}>
                  {entry.position.name}
                  <span className={styles["muted-inline"]}>
                    {" "}
                    · {entry.team.name}
                  </span>
                </span>
                {entry.open > 1 ? (
                  <span className={styles.badge}>{entry.open} open</span>
                ) : null}
                <ChevronRight
                  aria-hidden
                  size={16}
                  className={styles["row-chevron"]}
                />
              </DemoButton>
            </li>
          ))}
        </ul>
      </>
    ) : null}
    <h4 className={styles["overview-subhead"]}>Teams</h4>
    <ul>
      {staffing.byTeam.map(({ team, confirmed, pending, open }) => (
        <li key={team.id} className={styles["team-line"]}>
          <span className={`${styles.truncate} ${styles.grow}`}>
            {team.name}
          </span>
          <span className={styles["team-count"]}>
            {confirmed + pending}/{confirmed + pending + open}
          </span>
          <FilledBar
            confirmed={confirmed}
            pending={pending}
            total={confirmed + pending + open}
            size="sm"
          />
        </li>
      ))}
    </ul>
  </OverviewCard>
);

const SongsCard = ({ summary }: { summary: PlanSummary }) => (
  <OverviewCard
    icon={<ListMusic aria-hidden size={16} />}
    title="Songs"
    description={`${plural(summary.songs.length, "song", "songs")} · ${summary.serviceLength} service`}
    action="plan"
  >
    <ol>
      {summary.songs.map((song, index) => (
        <li key={song.id} className={styles["overview-line"]}>
          <span className={styles["line-number"]}>{index + 1}</span>
          <span className={`${styles.truncate} ${styles.grow}`}>
            {song.title}
          </span>
          {song.songKey === undefined ? (
            <span className={styles["no-key"]}>No key</span>
          ) : (
            <span className={styles.badge}>{song.songKey}</span>
          )}
        </li>
      ))}
    </ol>
  </OverviewCard>
);

const TimesCard = () => (
  <OverviewCard
    icon={<Clock3 aria-hidden size={16} />}
    title="Times"
    description={plural(times.length, "time", "times")}
    action="times"
  >
    <ul>
      {times.map((time) => (
        <li key={time.id} className={styles["overview-line"]}>
          <span className={`${styles.truncate} ${styles.grow}`}>
            {time.day}
            <span className={styles["muted-inline"]}>
              {" · "}
              {time.start}
            </span>
          </span>
          <span className={styles.badge} data-tone={time.type}>
            {time.name}
          </span>
        </li>
      ))}
    </ul>
  </OverviewCard>
);

/** A plan's home: what's ready, what isn't, and a way into each view. */
export const OverviewView = () => {
  const staffing = useStaffing();
  const summary = usePlanSummary();
  return (
    <div className={styles.overview}>
      <ReadinessCard staffing={staffing} summary={summary} />
      <PeopleCard staffing={staffing} />
      <SongsCard summary={summary} />
      <TimesCard />
    </div>
  );
};
