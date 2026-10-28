import {
  CHORD_CHART_PDF_MAX_BYTES,
  bytesToBase64,
  readPdfBytes,
} from "@pcobooster/api/modules/planning-center/chord-charts";
import { isPlanningCenterPathId } from "@pcobooster/api/modules/planning-center/path-ids";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterPlansService } from "@pcobooster/api/planning-center/services/plans-service";
import { ExternalServiceFailure } from "@pcobooster/contracts/faults/external-service-failure";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import {
  PLAN_FILE_LINK_TYPES,
  planFileDeclaresPdf,
} from "@pcobooster/contracts/http/plan-files";
import type {
  PlanFile,
  PlanFileLink,
  PlanFileOpenInput,
  PlanFiles,
  PlanFilesInput,
} from "@pcobooster/contracts/http/plan-files";
import { isNumber, isString } from "@pcobooster/planning-center-models/json";
import type { JsonValue } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

export type PlanFilesService = Pick<
  PlanningCenterPlansService,
  "getPlanAttachmentsPage" | "getPlanAttachment" | "openPlanAttachment"
>;

export interface PlanFileDependencies {
  readonly plans: PlanFilesService;
  readonly fetch: typeof globalThis.fetch;
}

const text = (value: JsonValue | undefined): string =>
  isString(value) ? value : "";

const notFound = () =>
  new NotFound({
    message: "Planning Center has no file at this link.",
    resource: "attachment",
  });

const failure = (message: string, cause?: unknown) =>
  new ExternalServiceFailure({ message, service: "planning-center", cause });

export const normalizePlanFile = (resource: PCResource): PlanFile => {
  const { attributes } = resource;
  const owner = resource.relationships?.attachable?.data;
  const attachable =
    owner !== undefined && owner !== null && !Array.isArray(owner)
      ? owner
      : null;
  const contentType = text(attributes.content_type);
  const audio =
    contentType.startsWith("audio/") || attributes.filetype === "audio";
  const size = attributes.file_size;
  return {
    id: resource.id,
    name:
      text(attributes.display_name) ||
      text(attributes.filename) ||
      "Untitled file",
    filename: text(attributes.filename),
    contentType,
    fileType: text(attributes.filetype),
    providerType: text(attributes.pco_type),
    size: isNumber(size) && Number.isSafeInteger(size) && size >= 0 ? size : 0,
    hasPreview: attributes.has_preview === true,
    // Songs can stream audio without allowing its download.
    downloadable:
      attributes.downloadable === true &&
      !(audio && attributes.allow_mp3_download === false),
    streamable: attributes.web_streamable === true,
    ownerType: attachable?.type ?? "Plan",
    ownerId: attachable?.id ?? null,
  };
};

/** One page of the plan's files, in Planning Center's order. */
export const listPlanFiles = (
  input: PlanFilesInput,
  plans: Pick<PlanFilesService, "getPlanAttachmentsPage">
): Effect.Effect<PlanFiles, PlanningCenterError | NotFound> =>
  Effect.gen(function* listFiles() {
    if (
      !(
        isPlanningCenterPathId(input.serviceTypeId) &&
        isPlanningCenterPathId(input.planId)
      )
    ) {
      return yield* notFound();
    }
    const page = yield* plans.getPlanAttachmentsPage(
      input.serviceTypeId,
      input.planId,
      input.offset ?? 0
    );
    return {
      files: page.data.flatMap((resource) =>
        isPlanningCenterPathId(resource.id) ? [normalizePlanFile(resource)] : []
      ),
      nextOffset: page.nextOffset,
    };
  });

/** https with a host and no embedded credentials: a link carries only its own signature. */
const isSecureLink = (value: string): boolean => {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === ""
  );
};

/** Only Planning Center's own storage is fetched by the server; other links stay in the browser. */
export const isProviderFileUrl = (value: string): boolean => {
  if (!isSecureLink(value)) {
    return false;
  }
  const url = new URL(value);
  return (
    (url.port === "" || url.port === "443") &&
    ["amazonaws.com", "planningcenteronline.com", "planningcenter.com"].some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    )
  );
};

const PDF_DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_FILE_REDIRECTS = 3;
const REDIRECT_MIN = 300;
const REDIRECT_MAX = 399;

/** Follows redirects by hand so every hop is checked against Planning Center's storage. */
const downloadProviderFile = (
  initialUrl: string,
  fetch: typeof globalThis.fetch
): Effect.Effect<Response, ExternalServiceFailure> =>
  Effect.gen(function* download() {
    let url = initialUrl;
    for (let redirects = 0; redirects <= MAX_FILE_REDIRECTS; redirects += 1) {
      const current = url;
      if (!isProviderFileUrl(current)) {
        return yield* failure(
          "This linked PDF must be opened in its own viewer."
        );
      }
      const response = yield* Effect.tryPromise({
        try: async (signal) =>
          await fetch(current, {
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(PDF_DOWNLOAD_TIMEOUT_MS),
            ]),
            redirect: "manual",
          }),
        catch: (cause) =>
          failure("The file could not be downloaded for preview.", cause),
      });
      if (response.status < REDIRECT_MIN || response.status > REDIRECT_MAX) {
        if (!response.ok) {
          return yield* failure(
            "The file link expired or the file is unavailable. Try again."
          );
        }
        return response;
      }
      const location = response.headers.get("location");
      yield* Effect.promise(async () => {
        try {
          await response.body?.cancel();
        } catch {
          // Dropping a redirect's body is best effort.
        }
      });
      if (location === null || !URL.canParse(location, current)) {
        return yield* failure("The file's redirect is invalid.");
      }
      url = new URL(location, current).href;
    }
    return yield* failure("The file redirected too many times to preview.");
  });

const PDF_SIGNATURE = "%PDF-";

/**
 * The file's PDF, base64 encoded. A file Planning Center calls a PDF must be one; any other
 * file is null when it is too large to be a chart or isn't a PDF, and opens as its link.
 */
export const readProviderPdf = (
  url: string,
  declaredPdf: boolean,
  fetch: typeof globalThis.fetch
) =>
  Effect.gen(function* readPdf() {
    const response = yield* downloadProviderFile(url, fetch);
    const declaredSize = Number(response.headers.get("Content-Length"));
    if (!declaredPdf && declaredSize > CHORD_CHART_PDF_MAX_BYTES) {
      yield* Effect.promise(async () => {
        try {
          await response.body?.cancel();
        } catch {
          // Stopping the download is best effort; the size already decides the answer.
        }
      });
      return null;
    }
    const bytes = yield* readPdfBytes(response);
    if (
      new TextDecoder().decode(bytes.subarray(0, PDF_SIGNATURE.length)) ===
      PDF_SIGNATURE
    ) {
      return bytesToBase64(bytes);
    }
    if (!declaredPdf) {
      return null;
    }
    return yield* failure(
      "This file is not a PDF. Open the original file instead."
    );
  });

/**
 * A short-lived link to one of the plan's files, honoring Planning Center's preview, stream,
 * and download permissions. `as: "pdf"` also returns the PDF itself, downloaded with a size
 * limit from Planning Center's storage only.
 */
export const openPlanFile = (
  input: PlanFileOpenInput,
  { plans, fetch }: PlanFileDependencies
): Effect.Effect<
  PlanFileLink,
  PlanningCenterError | NotFound | Forbidden | ExternalServiceFailure
> =>
  Effect.gen(function* openFile() {
    const ids = [input.serviceTypeId, input.planId, input.attachmentId];
    if (!ids.every(isPlanningCenterPathId)) {
      return yield* notFound();
    }
    const file = normalizePlanFile(
      yield* plans.getPlanAttachment(
        input.serviceTypeId,
        input.planId,
        input.attachmentId
      )
    );
    const preview =
      file.hasPreview &&
      (input.as === "preview" || (!file.downloadable && !file.streamable));
    if (
      !(file.downloadable || file.streamable || preview) &&
      !PLAN_FILE_LINK_TYPES.has(file.providerType)
    ) {
      return yield* new Forbidden({
        message:
          "Planning Center doesn't allow this file to be previewed or downloaded.",
      });
    }
    const url = yield* plans.openPlanAttachment(
      input.serviceTypeId,
      input.planId,
      input.attachmentId,
      preview
    );
    if (!isSecureLink(url)) {
      return yield* failure(
        "Planning Center did not return a secure link to this file."
      );
    }
    if (input.as !== "pdf" || preview) {
      return { url, preview };
    }
    const data = yield* readProviderPdf(url, planFileDeclaresPdf(file), fetch);
    return data === null ? { url, preview } : { url, preview, data };
  });
