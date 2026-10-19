import { Schema, SchemaGetter } from "effect";

/**
 * Search params the product routes read. Values arrive as strings (`lib/search-params.ts`);
 * a repeated key arrives as an array. Only a single value is honored: repeated values are
 * ambiguous and read as absent rather than failing the page.
 */
const singleOfRepeated = Schema.Array(Schema.String).pipe(
  Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
    decode: SchemaGetter.transform((values: readonly string[]) =>
      values.length === 1 ? values[0] : undefined
    ),
    encode: SchemaGetter.transform((value: string | undefined) =>
      value === undefined ? [] : [value]
    ),
  })
);
const optionalParam = Schema.optional(
  Schema.Union([Schema.String, singleOfRepeated])
);

/** A route's search params, validated by TanStack Router through Standard Schema. */
const routeSearch = <
  const Fields extends Readonly<Record<string, typeof optionalParam>>,
>(
  fields: Fields
) => Schema.toStandardSchemaV1(Schema.Struct(fields));

/** `/auth`: where to go after sign-in, and a Better Auth OAuth error code. */
export const authSearchSchema = routeSearch({
  next: optionalParam,
  error: optionalParam,
});

/** Plan workspace views: the selected team position slot. */
export const planWorkspaceSearchSchema = routeSearch({
  teamId: optionalParam,
  positionId: optionalParam,
});

/**
 * People dashboard: the view (`month`; Health when absent) and the team scope (`all`, `mine`,
 * or `team:<id>`; the viewer's default when absent). The page reads unknown values as absent.
 */
export const peopleSearchSchema = routeSearch({
  view: optionalParam,
  scope: optionalParam,
});

/** Person detail: the calendar month, `YYYY-MM`; the API validates it. */
export const personSearchSchema = routeSearch({
  month: optionalParam,
});

/** Songs library: which songs it lists and their order; unknown values fall back. */
export const songsSearchSchema = routeSearch({
  show: optionalParam,
  sort: optionalParam,
});

/** A song's pages: the arrangement shown and edited; unknown ids fall back to the first. */
export const songSearchSchema = routeSearch({
  arrangement: optionalParam,
});
