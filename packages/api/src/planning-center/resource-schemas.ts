import { optionalText } from "@pcobooster/api/planning-center/attribute-schemas";
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

export const pcResourceIdentifierSchema = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
}) satisfies Schema.Codec<PCResourceIdentifier, unknown>;

/*
 * Two decoders. The strict one below is a single schema pass that every well-formed response
 * takes. Only when it fails does the tolerant one (further down) read the body again row by row,
 * so a church's odd data costs its own reads the extra work and nobody else's.
 */

export const pcRelationshipSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Union([
        pcResourceIdentifierSchema,
        Schema.mutable(Schema.Array(pcResourceIdentifierSchema)),
      ])
    )
  ),
  links: Schema.optional(Schema.Struct({ related: optionalText })),
}) satisfies Schema.Codec<PCRelationship, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Resources are only decoded from `JSON.parse` output, whose values are JSON by construction, so
 * attributes are checked to be an object and never walked: validating every attribute again cost
 * several ms of Worker CPU per page. Each module validates the fields it consumes.
 */
const attributesSchema = Schema.declare(isJsonObject).pipe(
  Schema.withDecodingDefault(Effect.succeed({}))
);

export const pcResourceSchema = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  attributes: attributesSchema,
  relationships: Schema.optional(
    Schema.Record(Schema.String, pcRelationshipSchema)
  ),
}) satisfies Schema.Codec<PCResource, unknown>;

export const pcResourcesSchema = Schema.mutable(Schema.Array(pcResourceSchema));

const responseMetadata = {
  included: Schema.optional(pcResourcesSchema),
  meta: Schema.optional(
    Schema.Struct({
      total_count: Schema.optional(Schema.Finite),
      count: Schema.optional(Schema.Finite),
      next: Schema.optional(Schema.Struct({ offset: Schema.Finite })),
      prev: Schema.optional(Schema.Struct({ offset: Schema.Finite })),
    })
  ),
  links: Schema.optional(
    Schema.Struct({
      self: optionalText,
      next: optionalText,
      prev: optionalText,
    })
  ),
};

const decodeStrictResource = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Struct({ data: pcResourceSchema, ...responseMetadata })
  )
);

/** A collection's `data`; a single resource where a list was expected reads as a list of one. */
const collectionDataSchema = Schema.Union([
  // Lists first: nearly every collection answer is one, so the union rarely tries twice.
  pcResourcesSchema,
  pcResourceSchema,
]).pipe(
  Schema.decodeTo(
    Schema.mutable(Schema.Array(Schema.toType(pcResourceSchema))),
    {
      decode: SchemaGetter.transform(
        (data: PCResource | PCResource[]): PCResource[] =>
          Array.isArray(data) ? data : [data]
      ),
      encode: SchemaGetter.transform((data: PCResource[]) => data),
    }
  )
);

const decodeStrictCollection = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Struct({ data: collectionDataSchema, ...responseMetadata })
  )
);

/** `schema`'s value, or absent when Planning Center sends something else in its place. */
const absentWhenMalformed = <S extends Schema.Top>(schema: S) =>
  schema.pipe(Schema.catchDecoding(() => Effect.succeedNone));

/** A link that is not text reads as absent; `null` reads as `undefined`, as above. */
const tolerantLink = Schema.optional(
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

/** Linkage Planning Center malformed (an identifier without an id) reads as no linkage. */
const tolerantRelationshipSchema = Schema.Struct({
  data: Schema.optional(
    pcRelationshipSchema.fields.data.schema.pipe(
      Schema.catchDecoding(() => Effect.succeedSome(null))
    )
  ),
  links: Schema.optional(
    absentWhenMalformed(Schema.Struct({ related: tolerantLink }))
  ),
}) satisfies Schema.Codec<PCRelationship, unknown>;

/**
 * A resource's `type` and `id` are its identity, so they stay required and a row without them
 * is dropped. Missing, `null`, or non-object attributes read as none, and an unreadable
 * relationship reads as absent.
 */
const tolerantResourceSchema = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  attributes: Schema.declare(isJsonObject).pipe(
    Schema.catchDecoding(() => Effect.succeedSome({})),
    Schema.withDecodingDefault(Effect.succeed({}))
  ),
  relationships: Schema.optional(
    absentWhenMalformed(
      Schema.Record(
        Schema.String,
        absentWhenMalformed(tolerantRelationshipSchema)
      )
    )
  ),
}) satisfies Schema.Codec<PCResource, unknown>;

const tolerantCount = Schema.optional(absentWhenMalformed(Schema.Finite));
const tolerantOffset = Schema.optional(
  absentWhenMalformed(Schema.Struct({ offset: Schema.Finite }))
);

/** Rows are decoded one by one, so a row Planning Center malformed is dropped on its own. */
const rowsSchema = Schema.Array(Schema.Unknown);

/** Pagination and links are hints: a malformed one reads as absent rather than failing the page. */
const tolerantMetadata = {
  included: Schema.optional(absentWhenMalformed(rowsSchema)),
  meta: Schema.optional(
    absentWhenMalformed(
      Schema.Struct({
        total_count: tolerantCount,
        count: tolerantCount,
        next: tolerantOffset,
        prev: tolerantOffset,
      })
    )
  ),
  links: Schema.optional(
    absentWhenMalformed(
      Schema.Struct({
        self: tolerantLink,
        next: tolerantLink,
        prev: tolerantLink,
      })
    )
  ),
};

const decodeTolerantResource = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Struct({ data: tolerantResourceSchema, ...tolerantMetadata })
  )
);

const decodeTolerantCollection = Schema.decodeUnknownResult(
  Schema.fromJsonString(
    Schema.Struct({
      data: Schema.Union([
        rowsSchema,
        Schema.Record(Schema.String, Schema.Unknown),
      ]),
      ...tolerantMetadata,
    })
  )
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

const decodeRow = Schema.decodeUnknownResult(tolerantResourceSchema);
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
> = (text) => {
  const strict = decodeStrictResource(text);
  if (Result.isSuccess(strict)) {
    return Result.succeed({ value: strict.success, dropped: [] });
  }
  return Result.map(
    decodeTolerantResource(text),
    ({ included, ...response }) => {
      const dropped: DroppedRow[] = [];
      const value: PCApiResponse<PCResource> =
        included === undefined
          ? response
          : { ...response, included: readRows(included, "included", dropped) };
      return { value, dropped };
    }
  );
};

export const decodeCollectionResponse: JsonBodyDecoder<
  PCApiResponse<PCResource[]>
> = (text) => {
  const strict = decodeStrictCollection(text);
  if (Result.isSuccess(strict)) {
    return Result.succeed({ value: strict.success, dropped: [] });
  }
  return Result.map(
    decodeTolerantCollection(text),
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
};
