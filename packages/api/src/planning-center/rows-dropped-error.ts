import type { DroppedPlanningCenterRow } from "@pcobooster/api/planning-center/request-accounting";

/** Dropped rows of one kind: the same resource type from one endpoint, broken at the same fields. */
export interface DroppedRowGroup {
  /** The Planning Center path with ids replaced, so every church's reports group together. */
  readonly endpoint: string;
  readonly resourceType: string;
  /** Each failing field without row positions, as `data[].id: Expected string`. */
  readonly fields: readonly string[];
  readonly rows: number;
}

const ID_SEGMENT = /\/\d+(?=\/|$)/gu;
const ROW_POSITION = /\[\d+\]/gu;

/** Groups dropped rows by endpoint, resource type, and failing fields; never by value. */
export const groupDroppedRows = (
  rows: readonly DroppedPlanningCenterRow[]
): DroppedRowGroup[] => {
  const groups = new Map<string, DroppedRowGroup>();
  for (const row of rows) {
    const endpoint = row.endpoint.replaceAll(ID_SEGMENT, "/:id");
    const resourceType = row.resourceType ?? "unknown";
    const fields = row.issues.map(
      ({ path, message }) =>
        `${path.replaceAll(ROW_POSITION, "[]")}: ${message}`
    );
    const key = JSON.stringify([endpoint, resourceType, fields]);
    const group = groups.get(key);
    groups.set(key, {
      endpoint,
      resourceType,
      fields,
      rows: (group?.rows ?? 0) + 1,
    });
  }
  return [...groups.values()];
};

/** Rows a successful read left out, reported so a church's odd data shows up in error tracking. */
export class PlanningCenterRowsDroppedError extends Error {
  override readonly name = "PlanningCenterRowsDroppedError";
  readonly group: DroppedRowGroup;

  constructor(group: DroppedRowGroup) {
    super(
      `Dropped ${String(group.rows)} ${group.resourceType} row(s) from ${group.endpoint} it could not read (${group.fields.join(", ")})`
    );
    this.group = group;
  }
}
