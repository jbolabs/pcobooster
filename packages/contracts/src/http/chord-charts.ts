import {
  CHORD_CHART_CHORD_COLORS,
  CHORD_CHART_FONT_SIZES,
  CHORD_CHART_MARGINS,
  CHORD_CHART_MAX_COLUMNS,
  CHORD_CHART_ORIENTATIONS,
  CHORD_CHART_PAGE_SIZES,
} from "@pcobooster/contracts/chord-charts";
/** Chord charts and lyrics, all behind the `chordCharts` flag. */
import { read, write } from "@pcobooster/contracts/http/endpoint";
import { planningCenterGroup } from "@pcobooster/contracts/http/group";
import {
  mutableArray,
  finiteNumber,
  integer,
  requiredId,
} from "@pcobooster/contracts/http/schema";
import { keyOptionSchema } from "@pcobooster/contracts/http/song-schemas";
import { Struct, Schema } from "effect";

const NAME_MAX_LENGTH = 255;
const LYRICS_QUERY_MIN_LENGTH = 2;
const LYRICS_QUERY_MAX_LENGTH = 200;

const fontSizeSchema = integer.check(
  Schema.makeFilter((size: number) =>
    CHORD_CHART_FONT_SIZES.some((allowed) => allowed === size)
      ? undefined
      : "Font size must be one Services offers"
  )
);

/** Print settings Services stores beside the chart and uses for its PDFs. */
export const chordChartLayoutSchema = Schema.Struct({
  font: Schema.NullOr(Schema.String),
  fontSize: Schema.NullOr(fontSizeSchema),
  columns: Schema.NullOr(
    integer.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(CHORD_CHART_MAX_COLUMNS)
    )
  ),
  chordColor: Schema.NullOr(
    integer.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(CHORD_CHART_CHORD_COLORS.length - 1)
    )
  ),
  pageSize: Schema.NullOr(Schema.Literals(CHORD_CHART_PAGE_SIZES)),
  orientation: Schema.NullOr(Schema.Literals(CHORD_CHART_ORIENTATIONS)),
  margin: Schema.NullOr(Schema.Literals(CHORD_CHART_MARGINS)),
});

export const chordChartArrangementSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  archived: Schema.Boolean,
  /** Lyrics & Chords text in Services' ChordPro-based format. */
  chordChart: Schema.String,
  /** The key the chords are written in. */
  chordChartKey: Schema.NullOr(Schema.String),
  /** Lyrics Services derives from the chart, used to start a new chart from lyrics only. */
  lyrics: Schema.String,
  keys: mutableArray(keyOptionSchema),
  layout: chordChartLayoutSchema,
  updatedAt: Schema.NullOr(Schema.String),
  /** Seconds. */
  length: Schema.NullOr(finiteNumber),
  bpm: Schema.NullOr(finiteNumber),
  /** Time signature, such as "6/8". */
  meter: Schema.NullOr(Schema.String),
  /** Section labels in the order the band plays them, such as "V1", "C". */
  sequence: mutableArray(Schema.String),
  /** The band's notes on this arrangement, such as "Capo 2". */
  notes: Schema.NullOr(Schema.String),
});

export const chordChartSongSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  author: Schema.String,
  ccliNumber: Schema.NullOr(integer),
  copyright: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
});

export const chordChartSongOutputSchema = Schema.Struct({
  song: chordChartSongSchema,
  arrangements: mutableArray(chordChartArrangementSchema),
});

export const chordChartSongInputSchema = Schema.Struct({ songId: requiredId });

/** `chordChartLayoutSchema.partial()`: any subset of the settings. */
const chordChartLayoutChangesSchema = chordChartLayoutSchema.mapFields(
  Struct.map(Schema.optional)
);

const chordChartEditFields = {
  chordChart: Schema.String,
  chordChartKey: Schema.NullOr(requiredId),
  layout: Schema.optional(chordChartLayoutChangesSchema),
};

export const chordChartUpdateInputSchema = Schema.Struct({
  ...chordChartEditFields,
  songId: requiredId,
  arrangementId: requiredId,
  /** The `updatedAt` the edit started from; a newer arrangement is a conflict. */
  baseUpdatedAt: Schema.NullOr(Schema.String),
});

export const chordChartCreateInputSchema = Schema.Struct({
  ...chordChartEditFields,
  songId: requiredId,
  name: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(NAME_MAX_LENGTH)
  ),
});

export const chordChartSongCreateInputSchema = Schema.Struct({
  /** A title, or a CCLI number for Services to fill in the song from SongSelect. */
  title: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(NAME_MAX_LENGTH)
  ),
  author: Schema.optional(
    Schema.Trim.check(Schema.isMaxLength(NAME_MAX_LENGTH))
  ),
  copyright: Schema.optional(
    Schema.Trim.check(Schema.isMaxLength(NAME_MAX_LENGTH))
  ),
  ccliNumber: Schema.optional(integer.check(Schema.isGreaterThan(0))),
});

/** A chart Services renders: one of the arrangement's keys, or its lyrics sheet. */
export const chordChartPdfInputSchema = Schema.Struct({
  songId: requiredId,
  arrangementId: requiredId,
  /** The arrangement key to render chords in; absent for the lyrics sheet. */
  keyId: Schema.optional(requiredId),
});

export const chordChartPdfOutputSchema = Schema.Struct({
  /** The PDF Services rendered, base64 encoded. */
  data: Schema.String,
});

/** A song's lyrics found by a web search, to start a chart from. */
export const lyricsSearchResultSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  artist: Schema.String,
  album: Schema.NullOr(Schema.String),
  durationSeconds: Schema.NullOr(finiteNumber),
  lyrics: Schema.String,
});

export const lyricsSearchInputSchema = Schema.Struct({
  query: Schema.Trim.check(
    Schema.isMinLength(LYRICS_QUERY_MIN_LENGTH),
    Schema.isMaxLength(LYRICS_QUERY_MAX_LENGTH)
  ),
});

const ARRANGEMENT = ["songId", "arrangementId"] as const;

export const chordCharts = planningCenterGroup(
  "chordCharts",
  read("song", "/songs/:songId/chord-charts", {
    params: chordChartSongInputSchema.fields,
    success: chordChartSongOutputSchema,
    feature: "chordCharts",
  }),
  /** A prepared write: the conflict check may stop on disconnect; the save always finishes. */
  write.patch(
    "update",
    "/songs/:songId/arrangements/:arrangementId/chord-chart",
    {
      params: Struct.pick(chordChartUpdateInputSchema.fields, ARRANGEMENT),
      payload: Struct.omit(chordChartUpdateInputSchema.fields, ARRANGEMENT),
      success: chordChartArrangementSchema,
      feature: "chordCharts",
    }
  ),
  write.post("create", "/songs/:songId/arrangements", {
    params: Struct.pick(chordChartCreateInputSchema.fields, ["songId"]),
    payload: Struct.omit(chordChartCreateInputSchema.fields, ["songId"]),
    success: chordChartArrangementSchema,
    feature: "chordCharts",
  }),
  write.post("createSong", "/songs", {
    payload: chordChartSongCreateInputSchema.fields,
    success: chordChartSongOutputSchema,
    feature: "chordCharts",
  }),
  read("pdf", "/songs/:songId/arrangements/:arrangementId/pdf", {
    params: Struct.pick(chordChartPdfInputSchema.fields, ARRANGEMENT),
    query: Struct.omit(chordChartPdfInputSchema.fields, ARRANGEMENT),
    success: chordChartPdfOutputSchema,
    feature: "chordCharts",
  }),
  read("lyricsSearch", "/lyrics", {
    query: lyricsSearchInputSchema.fields,
    success: mutableArray(lyricsSearchResultSchema),
    feature: "chordCharts",
  })
);

export type ChordChartLayout = typeof chordChartLayoutSchema.Type;
export type ChordChartArrangement = typeof chordChartArrangementSchema.Type;
export type ChordChartSong = typeof chordChartSongSchema.Type;
export type ChordChartSongOutput = typeof chordChartSongOutputSchema.Type;
export type ChordChartSongInput = typeof chordChartSongInputSchema.Type;
export type ChordChartUpdateInput = typeof chordChartUpdateInputSchema.Type;
export type ChordChartCreateInput = typeof chordChartCreateInputSchema.Type;
export type ChordChartSongCreateInput =
  typeof chordChartSongCreateInputSchema.Type;
export type ChordChartPdfInput = typeof chordChartPdfInputSchema.Type;
export type ChordChartPdf = typeof chordChartPdfOutputSchema.Type;
export type LyricsSearchResult = typeof lyricsSearchResultSchema.Type;
export type LyricsSearchInput = typeof lyricsSearchInputSchema.Type;
