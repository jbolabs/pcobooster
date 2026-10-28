import type { JsonObject } from "@pcobooster/planning-center-models/json";
import type {
  PCApiResponse,
  PCRelationship,
  PCResource,
  PCResourceIdentifier,
} from "@pcobooster/planning-center-models/types";
import {
  Effect,
  Option,
  Result,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";

/** `schema`'s value, or absent when Planning Center sends something else in its place. */
const absentWhenMalformed = <S extends Schema.Top>(schema: S) =>
  schema.pipe(Schema.catchDecoding(() => Effect.succeedNone));

/** A JSON:API link; `null` reads as `undefined`, and a link that is not text as absent. */
const optionalLinkSchema = Schema.optional(
  absentWhenMalformed(
    Schema.NullOr(Schema.String).pipe(
      Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
        decode: SchemaGetter.transform(
          (link: string | null) => link ?? undefined
        ),
        encode: SchemaGetter.transform(
          (link: string | undefined) => link ?? null
        ),
      })
    )
  )
);

export const pcResourceIdentifierSchema = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
}) satisfies Schema.Codec<PCResourceIdentifier, unknown>;

/** Linkage Planning Center sends malformed (an identifier without an id) reads as no linkage. */
const relationshipDataSchema = Schema.NullOr(
  Schema.Union([
    pcResourceIdentifierSchema,
    Schema.mutable(Schema.Array(pcResourceIdentifierSchema)),
  ])
).pipe(Schema.catchDecoding(() => Effect.succeedSome(null)));

export const pcRelationshipSchema = Schema.Struct({
  data: Schema.optional(relationshipDataSchema),
  links: Schema.optional(
    absentWhenMalformed(Schema.Struct({ related: optionalLinkSchema }))
  ),
}) satisfies Schema.Codec<PCRelationship, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Resources are only decoded from `JSON.parse` output, whose values are JSON by construction, so
 * attributes are checked to be an object and never walked: validating every attribute again cost
 * several ms of Worker CPU per page. Each module validates the fields it consumes. Missing,
 * `null`, or non-object attributes read as none.
 */
const attributesSchema = Schema.declare(isJsonObject).pipe(
  Schema.catchDecoding(() => Effect.succeedSome({})),
  Schema.withDecodingDefault(Effect.succeed({}))
);

/**
 * A resource's `type` and `id` are its identity, so they are required; everything else
 * Planning Center may leave out or malform, and an unreadable relationship reads as absent.
 */
export const pcResourceSchema = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  attributes: attributesSchema,
  relationships: Schema.optional(
    absentWhenMalformed(
      Schema.Record(Schema.String, absentWhenMalformed(pcRelationshipSchema))
    )
  ),
}) satisfies Schema.Codec<PCResource, unknown>;

export const pcResourcesSchema = Schema.mutable(Schema.Array(pcResourceSchema));

const optionalCount = Schema.optional(absentWhenMalformed(Schema.Finite));
const optionalOffset = Schema.optional(
  absentWhenMalformed(Schema.Struct({ offset: Schema.Finite }))
);

/** Pagination and links are hints: a malformed one reads as absent rather than failing the page. */
const responseMetadata = {
  meta: Schema.optional(
    absentWhenMalformed(
      Schema.Struct({
        total_count: optionalCount,
        count: optionalCount,
        next: optionalOffset,
        prev: optionalOffset,
      })
    )
  ),
  links: Schema.optional(
    absentWhenMalformed(
      Schema.Struct({
        self: optionalLinkSchema,
        next: optionalLinkSchema,
        prev: optionalLinkSchema,
      })
    )
  ),
};

/** Rows are decoded one by one, so a row Planning Center malformed is dropped on its own. */
const rowsSchema = Schema.Array(Schema.Unknown);
const includedRows = Schema.optional(absentWhenMalformed(rowsSchema));

const resourceEnvelopeSchema = Schema.fromJsonString(
  Schema.Struct({
    data: pcResourceSchema,
    included: includedRows,
    ...responseMetadata,
  })
);

/** A collection's `data`; a single resource where a list was expected reads as a list of one. */
const collectionEnvelopeSchema = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Union([
      // Lists first: nearly every collection answer is one, so the union rarely tries twice.
      rowsSchema,
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
    included: includedRows,
    ...responseMetadata,
  })
);

/** Where a value failed to decode, and what was expected there. Never the value itself. */
export interface DecodeIssue {
  readonly path: string;
  readonly message: string;
}

/** A row left out of a response because it could not be read. */
export interface DroppedRow {
  readonly path: string;
  readonly resourceType: string | undefined;
  readonly issues: readonly DecodeIssue[];
}

export interface DecodedBody<Output> {
  readonly value: Output;
  readonly dropped: readonly DroppedRow[];
}

/** Parses a JSON body and decodes it, failing with the schema's issue when either step fails. */
export type JsonBodyDecoder<Output> = (
  text: string
) => Result.Result<DecodedBody<Output>, Schema.SchemaError>;

/** Enough issues to find the field; a wholly different shape would list every row. */
const ISSUES_REPORTED = 3;

const toStandardIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const formatPath = (
  prefix: string,
  path: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
): string => {
  let formatted = prefix;
  for (const segment of path ?? []) {
    const key = segment instanceof Object ? segment.key : segment;
    if (Number.isInteger(key)) {
      formatted += `[${String(key)}]`;
    } else {
      formatted =
        formatted === "" ? String(key) : `${formatted}.${String(key)}`;
    }
  }
  return formatted;
};

/**
 * Where decoding failed and what was expected there. Effect leaves rejected values out of
 * issues unless asked to report them, so neither a path nor a message carries church data.
 */
export const describeDecodeIssues = (
  issue: SchemaIssue.Issue,
  prefix = ""
): DecodeIssue[] =>
  toStandardIssues(issue)
    .issues.slice(0, ISSUES_REPORTED)
    .map(({ path, message }) => ({ path: formatPath(prefix, path), message }));

const decodeRow = Schema.decodeUnknownResult(pcResourceSchema);
const decodeRowType = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.String })
);

/** Each row Planning Center sent that reads as a resource, recording the ones that do not. */
const readRows = (
  rows: readonly unknown[],
  location: "data" | "included",
  dropped: DroppedRow[]
): PCResource[] => {
  const resources: PCResource[] = [];
  for (const [index, row] of rows.entries()) {
    const decoded = decodeRow(row);
    if (Result.isSuccess(decoded)) {
      resources.push(decoded.success);
      continue;
    }
    const path = `${location}[${String(index)}]`;
    dropped.push({
      path,
      resourceType: Option.getOrUndefined(decodeRowType(row))?.type,
      issues: describeDecodeIssues(decoded.failure.issue, path),
    });
  }
  return resources;
};

export const decodeResourceResponse: JsonBodyDecoder<
  PCApiResponse<PCResource>
> = (text) =>
  Result.map(
    Schema.decodeUnknownResult(resourceEnvelopeSchema)(text),
    ({ included, ...response }) => {
      const dropped: DroppedRow[] = [];
      const value: PCApiResponse<PCResource> =
        included === undefined
          ? response
          : { ...response, included: readRows(included, "included", dropped) };
      return { value, dropped };
    }
  );

export const decodeCollectionResponse: JsonBodyDecoder<
  PCApiResponse<PCResource[]>
> = (text) =>
  Result.map(
    Schema.decodeUnknownResult(collectionEnvelopeSchema)(text),
    ({ data, included, ...response }) => {
      const dropped: DroppedRow[] = [];
      const rows = readRows(
        Array.isArray(data) ? data : [data],
        "data",
        dropped
      );
      const value: PCApiResponse<PCResource[]> =
        included === undefined
          ? { ...response, data: rows }
          : {
              ...response,
              data: rows,
              included: readRows(included, "included", dropped),
            };
      return { value, dropped };
    }
  );
