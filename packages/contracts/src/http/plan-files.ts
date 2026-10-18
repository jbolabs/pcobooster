/** A plan's files: its own, its items', and its songs' arrangements' and keys'. */
import { read } from "@pcobooster/contracts/http/endpoint";
import { planningCenterGroup } from "@pcobooster/contracts/http/group";
import {
  mutableArray,
  nonNegativeInteger,
  requiredId,
} from "@pcobooster/contracts/http/schema";
import { Schema, Struct } from "effect";

export const planFilesInputSchema = Schema.Struct({
  serviceTypeId: requiredId,
  planId: requiredId,
  /** Where the page starts in Planning Center's collection; omit for the first page. */
  offset: Schema.optional(
    Schema.FiniteFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0)
    )
  ),
});

export const planFileSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  filename: Schema.String,
  contentType: Schema.String,
  fileType: Schema.String,
  /** Planning Center's attachment type, such as `AttachmentChart::Chord`. */
  providerType: Schema.String,
  size: nonNegativeInteger,
  hasPreview: Schema.Boolean,
  downloadable: Schema.Boolean,
  streamable: Schema.Boolean,
  /** What the file is attached to: `Plan`, `Item`, `Song`, `Arrangement`, or `Key`. */
  ownerType: Schema.String,
  ownerId: Schema.NullOr(Schema.String),
});

export const planFilesSchema = Schema.Struct({
  files: mutableArray(planFileSchema),
  /** The next page's offset; null on the last page. */
  nextOffset: Schema.NullOr(nonNegativeInteger),
});

/**
 * How to open a file: its own link (default), Planning Center's preview of a document, or the
 * PDF itself, fetched by the server so the browser can render it without a cross-origin read.
 */
export const PLAN_FILE_OPEN_MODES = ["link", "preview", "pdf"] as const;

export const planFileOpenInputSchema = Schema.Struct({
  serviceTypeId: requiredId,
  planId: requiredId,
  attachmentId: requiredId,
  as: Schema.optional(Schema.Literals(PLAN_FILE_OPEN_MODES)),
});

export const planFileLinkSchema = Schema.Struct({
  /** Planning Center's short-lived signed link. */
  url: Schema.String,
  /** The PDF, base64 encoded, when opened `as: "pdf"`. */
  data: Schema.optional(Schema.String),
  /** The link is Planning Center's preview rather than the file. */
  preview: Schema.Boolean,
});

const FILES = "/service-types/:serviceTypeId/plans/:planId/files";
const PLAN = ["serviceTypeId", "planId"] as const;
const FILE = ["serviceTypeId", "planId", "attachmentId"] as const;

export const planFiles = planningCenterGroup(
  "planFiles",
  /** One page of up to 100 files; the browser reads pages while the list is open. */
  read("list", FILES, {
    params: Struct.pick(planFilesInputSchema.fields, PLAN),
    query: Struct.omit(planFilesInputSchema.fields, PLAN),
    success: planFilesSchema,
  }),
  /** Opening records a view in Planning Center and changes nothing else. */
  read("open", `${FILES}/:attachmentId/link`, {
    params: Struct.pick(planFileOpenInputSchema.fields, FILE),
    query: Struct.omit(planFileOpenInputSchema.fields, FILE),
    success: planFileLinkSchema,
  })
);

export type PlanFile = typeof planFileSchema.Type;
export type PlanFiles = typeof planFilesSchema.Type;
export type PlanFilesInput = typeof planFilesInputSchema.Type;
export type PlanFileOpenInput = typeof planFileOpenInputSchema.Type;
export type PlanFileOpenMode = (typeof PLAN_FILE_OPEN_MODES)[number];
export type PlanFileLink = typeof planFileLinkSchema.Type;
