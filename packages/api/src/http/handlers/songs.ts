import {
  addChordChartSong,
  commitChordChartSave,
  createChordChart,
  prepareChordChartSave,
  readChordChartPdf,
  readChordChartSong,
  searchChordChartLyrics,
} from "@pcobooster/api/application/chord-charts";
import {
  getRunSheetSongHistory,
  getRunSheetSongOptions,
  getRunSheetSongSchedule,
  searchRunSheetSongs,
  suggestRunSheetSongs,
} from "@pcobooster/api/application/run-sheet";
import {
  readSongAttachmentLink,
  readSongAttachments,
} from "@pcobooster/api/application/song-attachments";
import { readSongLibrary } from "@pcobooster/api/application/song-library";
import { preparedWrite } from "@pcobooster/api/http/write";
import { ProductApi } from "@pcobooster/contracts/http/api";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";

export const SongHandlers = Layer.mergeAll(
  HttpApiBuilder.group(ProductApi, "songs", (handlers) =>
    handlers
      .handle("search", ({ query }) => searchRunSheetSongs(query))
      .handle("suggestions", () => suggestRunSheetSongs())
      .handle("library", () => readSongLibrary())
      .handle("history", ({ params }) => getRunSheetSongHistory(params))
      .handle("schedule", ({ params }) => getRunSheetSongSchedule(params))
      .handle("options", ({ params }) => getRunSheetSongOptions(params))
      .handle("attachments", ({ params }) => readSongAttachments(params))
      .handle("attachmentLink", ({ params, query }) =>
        readSongAttachmentLink({ ...params, ...query })
      )
  ),
  HttpApiBuilder.group(ProductApi, "chordCharts", (handlers) =>
    handlers
      .handle("song", ({ params }) => readChordChartSong(params))
      .handle("update", ({ params, payload }) =>
        preparedWrite(
          prepareChordChartSave({ ...params, ...payload }),
          commitChordChartSave
        )
      )
      .handle("create", ({ params, payload }) =>
        createChordChart({ ...params, ...payload })
      )
      .handle("createSong", ({ payload }) => addChordChartSong(payload))
      .handle("pdf", ({ params, query }) =>
        readChordChartPdf({ ...params, ...query })
      )
      .handle("lyricsSearch", ({ query }) => searchChordChartLyrics(query))
  )
);
