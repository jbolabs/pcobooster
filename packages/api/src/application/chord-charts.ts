import type { ApplicationFault } from "@pcobooster/api/application/errors";
import type { PlanningCenterAccess } from "@pcobooster/api/application/planning-center-access";
import {
  explainPlanningCenterDenial,
  withPlanningCenterFaults,
} from "@pcobooster/api/application/planning-center-access";
import { PlanningCenterSongs } from "@pcobooster/api/application/planning-center/songs";
import { invalidateSongCatalog } from "@pcobooster/api/application/song-catalog-revision";
import { searchLyrics } from "@pcobooster/api/modules/lyrics/lrclib-search";
import type { LyricsSearchDependencies } from "@pcobooster/api/modules/lyrics/lrclib-search";
import {
  commitChordChartUpdate,
  createChordChartArrangement,
  createChordChartSong,
  getChordChartPdf,
  getChordChartSong,
  prepareChordChartUpdate,
} from "@pcobooster/api/modules/planning-center/chord-charts";
import type { PreparedChordChartUpdate } from "@pcobooster/api/modules/planning-center/chord-charts";
import type { Server } from "@pcobooster/api/server";
import type {
  ChordChartArrangement,
  ChordChartCreateInput,
  ChordChartPdf,
  ChordChartPdfInput,
  ChordChartSongCreateInput,
  ChordChartSongInput,
  ChordChartSongOutput,
  ChordChartUpdateInput,
  LyricsSearchInput,
  LyricsSearchResult,
} from "@pcobooster/contracts/http/chord-charts";
import { Effect } from "effect";

const viewDenied = explainPlanningCenterDenial(
  "Your Planning Center account can't view songs in Services. Ask a Services administrator for access."
);

const editDenied = explainPlanningCenterDenial(
  "Your Planning Center account can't edit songs in Services. Ask a Services administrator for permission to edit songs."
);

export const readChordChartSong = (
  input: ChordChartSongInput
): Effect.Effect<ChordChartSongOutput, ApplicationFault, PlanningCenterSongs> =>
  Effect.gen(function* readSongCharts() {
    const songsService = yield* PlanningCenterSongs;
    return yield* getChordChartSong(input.songId, songsService);
  }).pipe(viewDenied, withPlanningCenterFaults);

export const prepareChordChartSave = (
  input: ChordChartUpdateInput
): Effect.Effect<
  PreparedChordChartUpdate,
  ApplicationFault,
  PlanningCenterSongs
> =>
  Effect.gen(function* prepareSave() {
    const songsService = yield* PlanningCenterSongs;
    return yield* prepareChordChartUpdate(input, songsService);
  }).pipe(viewDenied, withPlanningCenterFaults);

export const commitChordChartSave = (
  prepared: PreparedChordChartUpdate
): Effect.Effect<
  ChordChartArrangement,
  ApplicationFault,
  PlanningCenterSongs
> =>
  Effect.gen(function* commitSave() {
    const songsService = yield* PlanningCenterSongs;
    return yield* commitChordChartUpdate(prepared, songsService);
  }).pipe(editDenied, withPlanningCenterFaults);

export const createChordChart = (
  input: ChordChartCreateInput
): Effect.Effect<
  ChordChartArrangement,
  ApplicationFault,
  PlanningCenterSongs
> =>
  Effect.gen(function* createArrangement() {
    const songsService = yield* PlanningCenterSongs;
    return yield* createChordChartArrangement(input, songsService);
  }).pipe(editDenied, withPlanningCenterFaults);

export const addChordChartSong = (
  input: ChordChartSongCreateInput
): Effect.Effect<
  ChordChartSongOutput,
  ApplicationFault,
  PlanningCenterSongs | PlanningCenterAccess | Server
> =>
  Effect.gen(function* addSong() {
    const songsService = yield* PlanningCenterSongs;
    return yield* createChordChartSong(
      input,
      songsService,
      invalidateSongCatalog
    );
  }).pipe(editDenied, withPlanningCenterFaults);

/**
 * Planning Center's own render of the saved chart, so the preview matches it exactly. Calls
 * the Worker's `fetch` through a wrapper: invoked as a method it loses its binding.
 */
export const readChordChartPdf = (
  input: ChordChartPdfInput
): Effect.Effect<ChordChartPdf, ApplicationFault, PlanningCenterSongs> =>
  Effect.gen(function* readPdf() {
    const songsService = yield* PlanningCenterSongs;
    return yield* getChordChartPdf(input, {
      songs: songsService,
      fetch: async (request, init) => await globalThis.fetch(request, init),
    });
  }).pipe(viewDenied, withPlanningCenterFaults);

const workerLyricsSearch: LyricsSearchDependencies = {
  fetch: async (input, init) => await globalThis.fetch(input, init),
};

/** Lyrics from the web to start a chart; one request to LRCLIB, none to Planning Center. */
export const searchChordChartLyrics = (
  input: LyricsSearchInput,
  dependencies: LyricsSearchDependencies = workerLyricsSearch
): Effect.Effect<LyricsSearchResult[], ApplicationFault> =>
  searchLyrics(input.query, dependencies).pipe(withPlanningCenterFaults);
