import {
  addCalendarDaysToDayKey,
  zonedWallTimeToUtcIso,
} from "@pcobooster/planning-center-models/calendar";
import * as Alchemy from "alchemy";
import { interpolate } from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { localState } from "alchemy/State";
import { Effect } from "effect";

import { sandboxOrganization } from "./scripts/planning-center-sandbox/api";
import {
  SandboxRecord,
  sandboxProviders,
} from "./scripts/planning-center-sandbox/resources";
import {
  sandboxPeople,
  sandboxPositions,
} from "./scripts/planning-center-sandbox/roster";

/** A fixed anchor keeps subsequent plans reproducible. Advance deliberately as the fixtures age. */
const firstSunday = "2026-08-23";
const time = (day: string, wallTime: string) =>
  zonedWallTimeToUtcIso(day, wallTime, sandboxOrganization.timeZone);

export default Alchemy.Stack(
  "pcobooster-planning-center-sandbox",
  { providers: sandboxProviders, state: localState() },
  Effect.gen(function* sandbox() {
    const stage = yield* Alchemy.Stage;
    if (stage !== "sandbox") {
      return yield* Effect.die(
        new Error(
          "The Planning Center sandbox stack only accepts --stage sandbox."
        )
      );
    }
    const sunday = yield* SandboxRecord("SundayServices", {
      collection: "/services/v2/service_types",
      type: "ServiceType",
      identity: { name: "Agent Sandbox • Sunday" },
      attributes: { name: "Agent Sandbox • Sunday" },
    }).pipe(RemovalPolicy.retain());
    const midweek = yield* SandboxRecord("MidweekServices", {
      collection: "/services/v2/service_types",
      type: "ServiceType",
      identity: { name: "Agent Sandbox • Midweek" },
      attributes: { name: "Agent Sandbox • Midweek" },
    }).pipe(RemovalPolicy.retain());
    const band = yield* SandboxRecord("Band", {
      collection: interpolate`/services/v2/service_types/${sunday.id}/teams`,
      type: "Team",
      identity: { name: "Sandbox Band" },
      attributes: {
        name: "Sandbox Band",
        assigned_directly: true,
        rehearsal_team: true,
      },
      createOnly: true,
    }).pipe(RemovalPolicy.retain());
    const production = yield* SandboxRecord("Production", {
      collection: interpolate`/services/v2/service_types/${sunday.id}/teams`,
      type: "Team",
      identity: { name: "Sandbox Production" },
      attributes: { name: "Sandbox Production", assigned_directly: true },
      createOnly: true,
    }).pipe(RemovalPolicy.retain());
    const song = yield* SandboxRecord("Song", {
      collection: "/services/v2/songs",
      type: "Song",
      identity: { title: "Sandbox Morning Song" },
      attributes: {
        title: "Sandbox Morning Song",
        author: "Fictional test data",
        copyright: "Original test fixture",
      },
    }).pipe(RemovalPolicy.retain());
    const arrangement = yield* SandboxRecord("Arrangement", {
      collection: interpolate`/services/v2/songs/${song.id}/arrangements`,
      type: "Arrangement",
      identity: { name: "Sandbox acoustic" },
      attributes: {
        name: "Sandbox acoustic",
        bpm: 80,
        meter: "4/4",
        length: 240,
      },
    }).pipe(RemovalPolicy.retain());

    for (const [position, people] of [
      ["vocals", [sandboxPeople.avery, sandboxPeople.morgan]],
      ["guitar", [sandboxPeople.riley, sandboxPeople.avery]],
      ["keys", [sandboxPeople.morgan, sandboxPeople.jake]],
      ["audio", [sandboxPeople.casey, sandboxPeople.riley]],
    ] as const) {
      for (const personId of people) {
        yield* SandboxRecord(`Member${position}${personId}`, {
          collection: interpolate`/services/v2/service_types/${sunday.id}/team_positions/${sandboxPositions[position]}/person_team_position_assignments`,
          type: "PersonTeamPositionAssignment",
          identity: { person_id: personId },
          attributes: { person_id: personId },
        }).pipe(RemovalPolicy.retain());
      }
    }
    for (const [personId, reason, day] of [
      [sandboxPeople.avery, "Sandbox vacation", "2026-10-25"],
      [sandboxPeople.riley, "Sandbox unavailable", "2026-11-01"],
    ]) {
      yield* SandboxRecord(`Blockout${personId}`, {
        collection: `/services/v2/people/${personId}/blockouts`,
        type: "Blockout",
        identity: { reason },
        attributes: {
          reason,
          starts_at: time(day, "00:00"),
          ends_at: time(addCalendarDaysToDayKey(day, 1), "00:00"),
          share: false,
        },
      }).pipe(RemovalPolicy.retain());
    }
    for (let week = 0; week < 16; week += 1) {
      const day = addCalendarDaysToDayKey(firstSunday, week * 7);
      const title = `Sandbox Sunday ${day}`;
      const plan = yield* SandboxRecord(`Sunday${day}`, {
        collection: interpolate`/services/v2/service_types/${sunday.id}/plans`,
        type: "Plan",
        identity: { title },
        createAttributes: { title, public: false },
        attributes: { title, public: false, reminders_disabled: true },
      }).pipe(RemovalPolicy.retain());
      yield* SandboxRecord(`NeededKeys${day}`, {
        collection: interpolate`/services/v2/service_types/${sunday.id}/plans/${plan.id}/needed_positions`,
        type: "NeededPosition",
        identity: { team_position_name: "Keys", team_id: band.id },
        attributes: { quantity: 1 },
        createRelationships: {
          team: { data: { type: "Team", id: band.id } },
          team_position: {
            data: { type: "TeamPosition", id: sandboxPositions.keys },
          },
        },
      }).pipe(RemovalPolicy.retain());
      for (const [personId, position, status] of [
        [
          week % 2 === 0 ? sandboxPeople.avery : sandboxPeople.morgan,
          "Vocals",
          "C",
        ],
        [sandboxPeople.riley, "Guitar", week % 3 === 0 ? "D" : "U"],
        [sandboxPeople.casey, "Audio", "C"],
      ]) {
        const teamId = position === "Audio" ? production.id : band.id;
        yield* SandboxRecord(`Scheduled${day}${personId}`, {
          collection: interpolate`/services/v2/service_types/${sunday.id}/plans/${plan.id}/team_members`,
          type: "PlanPerson",
          identity: { person_id: personId, team_position_name: position },
          attributes: {
            person_id: personId,
            team_id: teamId,
            team_position_name: position,
            status,
            prepare_notification: false,
          },
        }).pipe(RemovalPolicy.retain());
      }
      for (const [key, name, type, start, end] of [
        ["Service", "Sunday service", "service", "10:00", "11:15"],
        ["Rehearsal", "Band rehearsal", "rehearsal", "08:30", "09:30"],
      ]) {
        yield* SandboxRecord(`${key}${day}`, {
          collection: interpolate`/services/v2/service_types/${sunday.id}/plans/${plan.id}/plan_times`,
          type: "PlanTime",
          identity: { name },
          attributes: {
            name,
            time_type: type,
            starts_at: time(day, start),
            ends_at: time(day, end),
            team_reminders: [],
          },
        }).pipe(RemovalPolicy.retain());
      }
      yield* SandboxRecord(`Welcome${day}`, {
        collection: interpolate`/services/v2/service_types/${sunday.id}/plans/${plan.id}/items`,
        type: "Item",
        identity: { title: "Welcome and announcements" },
        attributes: {
          title: "Welcome and announcements",
          length: 300,
          service_position: "during",
        },
      }).pipe(RemovalPolicy.retain());
      yield* SandboxRecord(`Song${day}`, {
        collection: interpolate`/services/v2/service_types/${sunday.id}/plans/${plan.id}/items`,
        type: "Item",
        identity: { title: "Sandbox Morning Song" },
        attributes: {
          title: "Sandbox Morning Song",
          length: 240,
          service_position: "during",
          song_id: song.id,
          arrangement_id: arrangement.id,
        },
      }).pipe(RemovalPolicy.retain());
    }
    return {
      organizationId: sandboxOrganization.id,
      sundayServiceTypeId: sunday.id,
      midweekServiceTypeId: midweek.id,
      bandTeamId: band.id,
      productionTeamId: production.id,
    };
  })
);
