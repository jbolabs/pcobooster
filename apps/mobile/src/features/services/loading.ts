/** Select only reads with an active selection and, for recent plans, an upcoming anchor. */
export const selectedQueries = <Query>(
  serviceTypes: readonly { readonly id: string }[],
  selectedIds: ReadonlySet<string>,
  queries: readonly Query[],
  anchors?: readonly (string | undefined)[]
): Query[] =>
  queries.filter(
    (_query, index) =>
      selectedIds.has(serviceTypes[index]?.id ?? "") &&
      (anchors === undefined || anchors[index] !== undefined)
  );

/** Disabled reads remain pending in TanStack Query and must not keep the agenda waiting. */
export const selectedLoading = (
  serviceTypes: readonly { readonly id: string }[],
  selectedIds: ReadonlySet<string>,
  queries: readonly {
    readonly isPending: boolean;
    readonly isError: boolean;
  }[],
  anchors?: readonly (string | undefined)[]
): boolean =>
  selectedQueries(serviceTypes, selectedIds, queries, anchors).some(
    (query) => query.isPending && !query.isError
  );
