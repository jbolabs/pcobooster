import { getSingleRelationshipId } from "@pcobooster/api/modules/planning-center/plan-items-shared";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterSongsService } from "@pcobooster/api/planning-center/services/songs-service";
import {
  addCalendarDaysToDayKey,
  formatCalendarDayInTimeZone,
} from "@pcobooster/planning-center-models/calendar";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { JsonValue } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

/** How far back a song's history reaches. Upcoming plans are always included. */
export const SONG_HISTORY_DAYS = 365;

/** One plan, in any service type, that scheduled the song. */
export interface SongHistoryEntry {
  planId: string | null;
  serviceTypeId: string | null;
  serviceTypeName: string;
  sortDate: Date;
  /** Planning Center's key label, such as "F: (highest note C)". */
  keyName: string | null;
  /** The key it started in, read from the label, such as "F" or "C#m". */
  startingKey: string | null;
  arrangementName: string | null;
}

const LEADING_KEY_PATTERN =
  /^\s*(?<key>[A-G](?:#|b|♯|♭)?(?:m(?!aj))?)(?![a-z#♯♭])/u;

const textOf = (value: JsonValue | undefined): string | null =>
  isNonEmptyString(value) ? value.trim() : null;

/** Reads schedules newest first; one without a usable date is left out. */
export const toSongHistory = (
  schedules: readonly PCResource[]
): SongHistoryEntry[] => {
  const entries: SongHistoryEntry[] = [];
  for (const schedule of schedules) {
    const { attributes } = schedule;
    const sortDate = new Date(textOf(attributes.plan_sort_date) ?? "");
    if (Number.isNaN(sortDate.getTime())) {
      continue;
    }
    const keyName = textOf(attributes.key_name);
    entries.push({
      planId: getSingleRelationshipId(schedule.relationships?.plan),
      serviceTypeId: getSingleRelationshipId(
        schedule.relationships?.service_type
      ),
      serviceTypeName: textOf(attributes.service_type_name) ?? "",
      sortDate,
      keyName,
      startingKey:
        keyName === null
          ? null
          : (LEADING_KEY_PATTERN.exec(keyName)?.groups?.key ?? null),
      arrangementName: textOf(attributes.arrangement_name),
    });
  }
  return entries.toSorted(
    (a, b) => b.sortDate.getTime() - a.sortDate.getTime()
  );
};

/** The plans, newest first, and whether Planning Center had more than were read. */
export interface SongHistory {
  entries: SongHistoryEntry[];
  truncated: boolean;
}

export interface SongHistoryDependencies {
  readonly songs: Pick<PlanningCenterSongsService, "getSongSchedules">;
  readonly resolveTimeZone: Effect.Effect<string, PlanningCenterError>;
}

/**
 * Where and when the song was sung across every service type over the past year, and
 * where it is already planned: one fresh Planning Center request.
 */
export const getSongHistory = (
  songId: string,
  now: Date,
  dependencies: SongHistoryDependencies
): Effect.Effect<SongHistory, PlanningCenterError> =>
  Effect.gen(function* readSongHistory() {
    const timeZone = yield* dependencies.resolveTimeZone;
    const afterDayKey = addCalendarDaysToDayKey(
      formatCalendarDayInTimeZone(now, timeZone),
      -SONG_HISTORY_DAYS
    );
    const schedules = yield* dependencies.songs.getSongSchedules(
      songId,
      afterDayKey
    );
    return {
      entries: toSongHistory(schedules.data),
      truncated: schedules.truncated,
    };
  });
