import { isPlanningCenterPathId } from "@pcobooster/api/modules/planning-center/path-ids";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterSongsService } from "@pcobooster/api/planning-center/services/songs-service";
import { ExternalServiceFailure } from "@pcobooster/contracts/faults/external-service-failure";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { PLAN_FILE_LINK_TYPES } from "@pcobooster/contracts/http/plan-files";
import type {
  SONG_ATTACHMENT_KINDS,
  songAttachmentLinkInputSchema,
  songAttachmentLinkSchema,
  songAttachmentSchema,
  songAttachmentsInputSchema,
  songAttachmentsSchema,
} from "@pcobooster/contracts/http/songs";
import {
  isNonEmptyString,
  isNumber,
} from "@pcobooster/planning-center-models/json";
import type { JsonValue } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

export type SongAttachment = typeof songAttachmentSchema.Type;
export type SongAttachments = typeof songAttachmentsSchema.Type;
export type SongAttachmentsInput = typeof songAttachmentsInputSchema.Type;
export type SongAttachmentLinkInput = typeof songAttachmentLinkInputSchema.Type;
export type SongAttachmentLink = typeof songAttachmentLinkSchema.Type;
type SongAttachmentKind = (typeof SONG_ATTACHMENT_KINDS)[number];

export type SongAttachmentsService = Pick<
  PlanningCenterSongsService,
  "getSongArrangementsWithKeys" | "getAttachmentsPage" | "openChartAttachment"
>;

/**
 * Keys whose files are read per call. Each is one request; with the arrangement's own files
 * and the (cached) arrangements read, a call stays far under `PROGRESSIVE_REQUEST_BUDGET`.
 */
export const MAX_ATTACHMENT_KEYS = 6;

const validId = isPlanningCenterPathId;

const notFound = () =>
  new NotFound({
    message: "Planning Center has no file at this link.",
    resource: "attachment",
  });

/** Planning Center's own chart renders: `AttachmentChart::Chord` per key, `::Lyric` per arrangement. */
const CHART_TYPE_PREFIX = "AttachmentChart";
const LYRICS_CHART_TYPE = "AttachmentChart::Lyric";

const PDF_EXTENSIONS = new Set(["pdf"]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "heic",
  "webp",
  "tif",
  "tiff",
]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "aif", "aiff"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v"]);
const DOCUMENT_EXTENSIONS = new Set([
  "txt",
  "rtf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "pages",
  "key",
  "numbers",
  "csv",
  "pro",
  "cho",
  "chopro",
]);
const DOCUMENT_TYPES = [
  "text/",
  "application/msword",
  "application/rtf",
  "application/vnd.openxmlformats",
  "application/vnd.ms-",
  "application/vnd.apple",
];

const text = (value: JsonValue | undefined): string | null =>
  isNonEmptyString(value) ? value.trim() : null;

const extensionOf = (filename: string): string => {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
};

/** How the app previews a stored file, by its content type, then its extension. */
export const storedFileKind = (
  contentType: string | null,
  filename: string
): SongAttachmentKind => {
  const type = contentType?.toLowerCase() ?? "";
  const extension = extensionOf(filename);
  if (type === "application/pdf" || PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }
  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (type.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (type.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (
    DOCUMENT_TYPES.some((prefix) => type.startsWith(prefix)) ||
    DOCUMENT_EXTENSIONS.has(extension)
  ) {
    return "document";
  }
  return "other";
};

/**
 * Only https addresses with a host and no embedded user name or password leave the server as
 * links: a link carries no credentials but its own signature.
 */
const secureLink = (value: string | null): string | null => {
  if (value === null || !URL.canParse(value)) {
    return null;
  }
  const url = new URL(value);
  const secure =
    url.protocol === "https:" &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === "";
  return secure ? url.href : null;
};

/**
 * A Planning Center attachment as the app lists it; null for broken rows. Chart renders are
 * listed too, since Planning Center shows them among an arrangement's files; often they are the
 * only ones.
 */
export const toSongAttachment = (
  resource: PCResource,
  keyId: string | null
): SongAttachment | null => {
  const { attributes } = resource;
  const pcoType = text(attributes.pco_type) ?? "";
  if (!validId(resource.id)) {
    return null;
  }
  const isChart = pcoType.startsWith(CHART_TYPE_PREFIX);
  const filename = text(attributes.filename) ?? "";
  const name = text(attributes.display_name) ?? (filename || "Untitled file");
  const contentType = text(attributes.content_type);
  const size = attributes.file_size;
  const isLink =
    PLAN_FILE_LINK_TYPES.has(pcoType) ||
    (filename === "" && text(attributes.linked_url) !== null);
  const linkUrl = isLink
    ? secureLink(text(attributes.linked_url) ?? text(attributes.remote_link))
    : null;
  const base = {
    id: resource.id,
    keyId,
    name,
    filename,
    contentType,
    linkUrl,
    // Planning Center omits these on some types; a missing flag allows a download attempt.
    downloadable: attributes.downloadable !== false,
    streamable: attributes.streamable === true,
  };
  if (isChart) {
    // Renders report a size of 0 until rendered, so it isn't known.
    return {
      ...base,
      kind: "pdf",
      fileSize: null,
      chart: pcoType === LYRICS_CHART_TYPE ? "lyrics" : "chord",
    };
  }
  let kind = storedFileKind(contentType, filename);
  if (isLink) {
    kind = "link";
  } else if (pcoType.startsWith("AttachmentRehearsalMix")) {
    kind = "audio";
  }
  return {
    ...base,
    kind,
    fileSize:
      isNumber(size) && Number.isSafeInteger(size) && size >= 0 ? size : null,
  };
};

const arrangementPath = (songId: string, arrangementId: string) =>
  `/services/v2/songs/${songId}/arrangements/${arrangementId}`;

const belongsTo = (key: PCResource, arrangementId: string): boolean => {
  const owner = key.relationships?.arrangement?.data;
  return owner !== undefined && owner !== null && !Array.isArray(owner)
    ? owner.id === arrangementId
    : false;
};

/** The keys Planning Center lists for the arrangement, in its order. */
const arrangementKeyIds = (
  included: readonly PCResource[],
  arrangementId: string
): string[] =>
  included.flatMap((resource) =>
    resource.type === "Key" &&
    belongsTo(resource, arrangementId) &&
    validId(resource.id)
      ? [resource.id]
      : []
  );

/**
 * An arrangement's files and its keys' files, read only: the arrangement's own collection, then
 * up to `MAX_ATTACHMENT_KEYS` keys' collections, one page each, Planning Center's chart renders
 * included. `truncated` says some were not read.
 */
export const getSongAttachments = (
  input: SongAttachmentsInput,
  songs: SongAttachmentsService
): Effect.Effect<SongAttachments, PlanningCenterError | NotFound> =>
  Effect.gen(function* readAttachments() {
    if (!(validId(input.songId) && validId(input.arrangementId))) {
      return yield* notFound();
    }
    const base = arrangementPath(input.songId, input.arrangementId);
    const arrangements = yield* songs.getSongArrangementsWithKeys(input.songId);
    const keyIds = arrangementKeyIds(
      arrangements.included,
      input.arrangementId
    );
    const readKeys = keyIds.slice(0, MAX_ATTACHMENT_KEYS);
    const collections: { path: string; keyId: string | null }[] = [
      { path: `${base}/attachments`, keyId: null },
      ...readKeys.map((keyId) => ({
        path: `${base}/keys/${keyId}/attachments`,
        keyId,
      })),
    ];
    const pages = yield* Effect.forEach(
      collections,
      ({ path, keyId }) =>
        Effect.map(songs.getAttachmentsPage(path), (page) => ({
          ...page,
          keyId,
        })),
      { concurrency: 3 }
    );
    return {
      attachments: pages.flatMap(({ data, keyId }) =>
        data.flatMap((resource) => {
          const attachment = toSongAttachment(resource, keyId);
          return attachment === null ? [] : [attachment];
        })
      ),
      truncated:
        keyIds.length > readKeys.length ||
        pages.some(({ next }) => next !== null),
    };
  });

/**
 * Planning Center's short-lived signed link to one stored file (its `open` action). The server
 * never downloads the file: audio and video stream on the device, and documents download there
 * without this app's credentials.
 */
export const getSongAttachmentLink = (
  input: SongAttachmentLinkInput,
  songs: Pick<SongAttachmentsService, "openChartAttachment">
): Effect.Effect<
  SongAttachmentLink,
  PlanningCenterError | NotFound | ExternalServiceFailure
> =>
  Effect.gen(function* openAttachment() {
    const ids = [input.songId, input.arrangementId, input.attachmentId];
    if (input.keyId !== undefined) {
      ids.push(input.keyId);
    }
    if (!ids.every(validId)) {
      return yield* notFound();
    }
    const base = arrangementPath(input.songId, input.arrangementId);
    const owner =
      input.keyId === undefined ? base : `${base}/keys/${input.keyId}`;
    const url = secureLink(
      yield* songs.openChartAttachment(
        `${owner}/attachments/${input.attachmentId}`
      )
    );
    if (url === null) {
      return yield* new ExternalServiceFailure({
        message: "Planning Center did not return a secure link to this file.",
        service: "planning-center",
      });
    }
    return { url };
  });
