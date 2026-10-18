import { useState } from "react";
import type { CSSProperties } from "react";

import { DemoButton } from "../ui/demo-control";
import {
  distanceFromPlan,
  findPosition,
  monthDayLabel,
  weekdayMonthDayLabel,
} from "./demo-model";
import type { DayEntry, HistoryDay } from "./demo-model";
import { PositionGlyph } from "./demo-parts";
import { plan } from "./fixtures";

import styles from "./product-demo.module.css";

const DAYS_PER_WEEK = 7;
/** Days this close to either end open their card against that edge. */
const EDGE_DAYS = 10;

const positionLabel = (entry: DayEntry): string => {
  const found = findPosition(entry.positionId);
  return found === undefined
    ? ""
    : `${found.team.name} - ${found.position.name}`;
};

const entryTone = (entry: DayEntry) => {
  if (entry.rehearsal) {
    return { tone: "rehearsal", label: "Rehearsal" } as const;
  }
  return entry.status === "confirmed"
    ? ({ tone: "confirmed", label: "Confirmed" } as const)
    : ({ tone: "pending", label: "Pending" } as const);
};

/** Services before rehearsals, as the product lists a day. */
const sortedEntries = (day: HistoryDay): DayEntry[] =>
  day.entries.toSorted((a, b) => Number(a.rehearsal) - Number(b.rehearsal));

const daySummary = (day: HistoryDay): string =>
  `${weekdayMonthDayLabel(day.offset)}: ${sortedEntries(day)
    .map(
      (entry) =>
        `${positionLabel(entry)}${entry.rehearsal ? " (rehearsal)" : ""}`
    )
    .join("; ")}`;

const DayCard = ({ day, count }: { day: HistoryDay; count: number }) => {
  const index = day.offset + (count - 1) / 2;
  const position: CSSProperties & { "--card-left": string } = {
    "--card-left": `${((index + 0.5) / count) * 100}%`,
  };
  let align = "center";
  if (day.offset < -EDGE_DAYS) {
    align = "start";
  } else if (day.offset > EDGE_DAYS) {
    align = "end";
  }
  return (
    <div
      className={styles["day-card"]}
      data-align={align}
      style={position}
      aria-hidden
    >
      <p className={styles["day-card-head"]}>
        <strong>{weekdayMonthDayLabel(day.offset)}</strong>
        <span data-current={day.offset === 0 ? "" : undefined}>
          {distanceFromPlan(day.offset)}
        </span>
      </p>
      <ul className={styles["day-card-list"]}>
        {sortedEntries(day).map((entry) => {
          const { tone, label } = entryTone(entry);
          const found = findPosition(entry.positionId);
          return (
            <li key={`${entry.positionId}-${entry.rehearsal}`}>
              {found === undefined ? null : (
                <PositionGlyph icon={found.position.icon} />
              )}
              <span className={styles["day-card-what"]}>
                <strong>{positionLabel(entry)}</strong>
                <span>{plan.serviceType}</span>
              </span>
              <span className={styles["day-card-status"]} data-tone={tone}>
                <span className={styles["day-card-dot"]} aria-hidden />
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const DayBar = ({
  day,
  active,
  onActivate,
  onDeactivate,
}: {
  day: HistoryDay;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) => {
  // How far the reveal wave travels before reaching this day.
  const wave: CSSProperties & { "--day-distance": number } = {
    "--day-distance": Math.abs(day.offset),
  };
  const bar = (
    <span
      className={styles["day-bar"]}
      data-kind={day.kind}
      data-status={day.status ?? undefined}
      data-reveal=""
      style={wave}
    />
  );
  const content =
    day.offset === 0 ? (
      <span className={styles["plan-day"]} style={wave}>
        {day.kind === "free" ? null : bar}
      </span>
    ) : (
      bar
    );
  if (day.kind === "free") {
    return (
      <span className={styles["day-column"]} aria-hidden>
        {content}
      </span>
    );
  }
  return (
    <DemoButton
      variant="day"
      aria-label={daySummary(day)}
      data-active={active ? "" : undefined}
      onPointerEnter={onActivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
    >
      {content}
    </DemoButton>
  );
};

/** A date under the bars, centered on its day; the ends align inward to stay in the row. */
const WeekDateLabel = ({
  day,
  index,
  count,
}: {
  day: HistoryDay;
  index: number;
  count: number;
}) => {
  const position: CSSProperties & { "--label-left": string } = {
    "--label-left": `${((index + 0.5) / count) * 100}%`,
  };
  let edge: string | undefined;
  if (index === 0) {
    edge = "start";
  } else if (index === count - 1) {
    edge = "end";
  }
  return (
    <span
      aria-hidden
      className={styles["week-label"]}
      data-current={day.offset === 0 ? "" : undefined}
      data-edge={edge}
      data-alternate={day.offset % (DAYS_PER_WEEK * 2) === 0 ? undefined : ""}
      style={position}
    >
      {monthDayLabel(day.offset)}
    </span>
  );
};

/**
 * Someone's days around the plan as thin bars sharing the row's width: a tall
 * colored bar for a service (green confirmed, amber pending), a short darker
 * bar for a rehearsal only, a short gray bar for a free day. The plan's day
 * sits in a dashed frame, with a date every week. Hovering or tapping a busy
 * day opens what's on it.
 */
export const DayBars = ({
  days,
  openOffset,
}: {
  days: readonly HistoryDay[];
  /** A day whose card starts open, for showcases; it closes once the pointer leaves. */
  openOffset?: number;
}) => {
  const [activeOffset, setActiveOffset] = useState<number | null>(
    openOffset ?? null
  );
  const activeDay = days.find((day) => day.offset === activeOffset);
  const busy = days.filter((day) => day.kind !== "free");
  const deactivate = () => {
    setActiveOffset(null);
  };

  return (
    <div className={styles["day-bars"]}>
      <p className={styles["sr-only"]}>
        {busy.length === 0
          ? "Nothing scheduled in the 4 weeks either side of this plan."
          : busy.map(daySummary).join(". ")}
      </p>
      <div
        className={styles["day-row"]}
        // A finger "leaves" the moment it lifts; a tapped day stays open until another tap.
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") {
            deactivate();
          }
        }}
      >
        {days.map((day) => (
          <DayBar
            key={day.offset}
            day={day}
            active={day.offset === activeOffset}
            onActivate={() => {
              setActiveOffset(day.offset);
            }}
            onDeactivate={deactivate}
          />
        ))}
      </div>
      {days.map((day, index) =>
        day.offset % DAYS_PER_WEEK === 0 ? (
          <WeekDateLabel
            key={day.offset}
            day={day}
            index={index}
            count={days.length}
          />
        ) : null
      )}
      {activeDay === undefined || activeDay.kind === "free" ? null : (
        <DayCard day={activeDay} count={days.length} />
      )}
    </div>
  );
};
