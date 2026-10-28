/** The organization's song catalog, history, and options. */
import { read } from "@pcobooster/contracts/http/endpoint";
import { planningCenterGroup } from "@pcobooster/contracts/http/group";
import {
  mutableArray,
  nonNegativeInteger,
  requiredId,
} from "@pcobooster/contracts/http/schema";
import {
  songCatalogEntrySchema,
  songOptionSetSchema,
} from "@pcobooster/contracts/http/song-schemas";
import { Schema, Struct } from "effect";

/** The song catalog is organization-wide, so search takes no service type. */
export const songsSearchInputSchema = Schema.Struct({ query: requiredId });

export const songsOptionsInputSchema = Schema.Struct({
  serviceTypeId: requiredId,
  songId: requiredId,
});

export const songLibraryEntrySchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  author: Schema.String,
  themes: Schema.String,
  /** Null when Planning Center has never scheduled the song. */
  lastScheduledAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.NullOr(Schema.Date),
});

/** Every visible song in the organization's library, A to Z. */
export const songLibrarySchema = Schema.Struct({
  songs: mutableArray(songLibraryEntrySchema),
  /**
   * The catalog read stopped at its page limit, so songs later in the alphabet are missing.
   * Hidden songs count toward the limit but aren't listed.
   */
  truncated: Schema.Boolean,
});

export const songsHistoryInputSchema = Schema.Struct({ songId: requiredId });

export const songHistoryEntrySchema = Schema.Struct({
  planId: Schema.NullOr(Schema.String),
  serviceTypeId: Schema.NullOr(Schema.String),
  serviceTypeName: Schema.String,
  sortDate: Schema.Date,
  keyName: Schema.NullOr(Schema.String),
  startingKey: Schema.NullOr(Schema.String),
  arrangementName: Schema.NullOr(Schema.String),
});

/** A song's past year and upcoming plans, newest first. */
export const songHistorySchema = Schema.Struct({
  entries: mutableArray(songHistoryEntrySchema),
  /**
   * Planning Center had more plans than the one page read, so the count is a floor. The newest
   * ones (and every upcoming one) are always read, so last and next stay right.
   */
  truncated: Schema.Boolean,
});

export const songsSuggestionsOutputSchema = Schema.Struct({
  /** Played most recently first. */
  recentlyPlayed: mutableArray(songCatalogEntrySchema),
  /** Played before, but not in the last few months. */
  resting: mutableArray(songCatalogEntrySchema),
});

/** How the app previews an attachment; `link` files live elsewhere (YouTube, Spotify, a site). */
export const SONG_ATTACHMENT_KINDS = [
  "pdf",
  "image",
  "audio",
  "video",
  "document",
  "link",
  "other",
] as const;

export const songAttachmentsInputSchema = Schema.Struct({
  songId: requiredId,
  arrangementId: requiredId,
});

/** Which of Planning Center's own chart renders a file is: a key's chord chart, or the lyrics sheet. */
export const SONG_CHART_RENDERS = ["chord", "lyrics"] as const;

/** A file attached to an arrangement or one of its keys, Planning Center's chart renders included. */
export const songAttachmentSchema = Schema.Struct({
  id: Schema.String,
  /** The key it is attached to; null for the arrangement's own files. */
  keyId: Schema.NullOr(Schema.String),
  name: Schema.String,
  filename: Schema.String,
  kind: Schema.Literals(SONG_ATTACHMENT_KINDS),
  contentType: Schema.NullOr(Schema.String),
  fileSize: Schema.NullOr(nonNegativeInteger),
  /** A `link` file's public https address; null for files Planning Center stores. */
  linkUrl: Schema.NullOr(Schema.String),
  /** Planning Center lets people download the file (`attachmentLink` works for documents). */
  downloadable: Schema.Boolean,
  /** Planning Center streams it (audio and video). */
  streamable: Schema.Boolean,
  /**
   * Set on Planning Center's own chart renders (listed as `pdf`, so builds that predate this
   * field still open them); absent on uploaded files.
   */
  chart: Schema.optional(Schema.Literals(SONG_CHART_RENDERS)),
});

export const songAttachmentsSchema = Schema.Struct({
  attachments: mutableArray(songAttachmentSchema),
  /** Some keys' files, or files past the first page, were not read. */
  truncated: Schema.Boolean,
});

export const songAttachmentLinkInputSchema = Schema.Struct({
  songId: requiredId,
  arrangementId: requiredId,
  attachmentId: requiredId,
  /** The key the file belongs to; absent for the arrangement's own files. */
  keyId: Schema.optional(requiredId),
  /**
   * `pdf` also returns the file itself when it is a PDF, fetched by the server so the browser
   * can render it in the app; Planning Center's signed links download PDFs instead of showing them.
   */
  as: Schema.optional(Schema.Literals(["link", "pdf"])),
});

/**
 * Planning Center's short-lived signed link to a stored file. Clients open it without their own
 * credentials and never keep it.
 */
export const songAttachmentLinkSchema = Schema.Struct({
  url: Schema.String,
  /** The PDF, base64 encoded, when opened `as: "pdf"` and the file is one. */
  data: Schema.optional(Schema.String),
});

export const songs = planningCenterGroup(
  "songs",
  read("search", "/songs", {
    query: songsSearchInputSchema.fields,
    success: mutableArray(songCatalogEntrySchema),
  }),
  read("suggestions", "/songs/suggestions", {
    success: songsSuggestionsOutputSchema,
  }),
  /**
   * The Songs page's library: behind the `chordCharts` flag, though it lives in this namespace.
   * Partial without a cursor (`truncated`).
   */
  read("library", "/songs/library", {
    success: songLibrarySchema,
    feature: "chordCharts",
  }),
  /**
   * Every plan in any service type that scheduled the song over the past year, newest first.
   * Superseded by `schedule`, which also says when the list is cut off; delete this once the
   * iOS update that reads `schedule` instead has shipped.
   */
  read("history", "/songs/:songId/history", {
    params: songsHistoryInputSchema.fields,
    success: mutableArray(songHistoryEntrySchema),
  }),
  /**
   * The song's plans over the past year and ahead, newest first, and whether Planning Center
   * had more than the one page read (`truncated`).
   */
  read("schedule", "/songs/:songId/schedule", {
    params: songsHistoryInputSchema.fields,
    success: songHistorySchema,
  }),
  read("options", "/service-types/:serviceTypeId/songs/:songId/options", {
    params: songsOptionsInputSchema.fields,
    success: songOptionSetSchema,
  }),
  /** An arrangement's files and its keys' files, read only, behind the `chordCharts` flag. */
  read(
    "attachments",
    "/songs/:songId/arrangements/:arrangementId/attachments",
    {
      params: songAttachmentsInputSchema.fields,
      success: songAttachmentsSchema,
      feature: "chordCharts",
    }
  ),
  /** Opens one stored file: Planning Center logs a view and changes nothing. */
  read(
    "attachmentLink",
    "/songs/:songId/arrangements/:arrangementId/attachments/:attachmentId/link",
    {
      params: Struct.pick(songAttachmentLinkInputSchema.fields, [
        "songId",
        "arrangementId",
        "attachmentId",
      ]),
      query: Struct.pick(songAttachmentLinkInputSchema.fields, ["keyId", "as"]),
      success: songAttachmentLinkSchema,
      feature: "chordCharts",
    }
  )
);

export type SongsSearchInput = typeof songsSearchInputSchema.Type;
export type SongsOptionsInput = typeof songsOptionsInputSchema.Type;
export type SongsSuggestions = typeof songsSuggestionsOutputSchema.Type;
export type SongLibraryEntry = typeof songLibraryEntrySchema.Type;
export type SongLibrary = typeof songLibrarySchema.Type;
export type SongsHistoryInput = typeof songsHistoryInputSchema.Type;
export type SongHistoryEntry = typeof songHistoryEntrySchema.Type;
export type SongHistory = typeof songHistorySchema.Type;
