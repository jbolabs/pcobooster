import { Resource } from "alchemy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Config, Effect, Redacted, Schema } from "effect";

import { makeSandboxApi, SandboxError } from "./api";
import type { Attributes, PcRecord, SandboxApi } from "./api";

export interface RecordProps {
  readonly collection: string;
  readonly type: string;
  /** Stable identifying fields allow recovery even in a fresh checkout with no Alchemy state. */
  readonly identity: Attributes;
  readonly attributes: Attributes;
  readonly createAttributes?: Attributes;
  readonly createRelationships?: Attributes;
  readonly createOnly?: boolean;
}
export interface RecordAttributes {
  readonly id: string;
  readonly collection: string;
  readonly attributes: Attributes;
}
export type SandboxRecordResource = Resource<
  "PlanningCenter.SandboxRecord",
  RecordProps,
  RecordAttributes
>;
export const SandboxRecord = Resource<SandboxRecordResource>(
  "PlanningCenter.SandboxRecord"
);

const relationshipSchema = Schema.Struct({
  data: Schema.NullOr(
    Schema.Union([
      Schema.Struct({ id: Schema.String }),
      Schema.Array(Schema.Struct({ id: Schema.String })),
    ])
  ),
});

const valueFor = (record: PcRecord, key: string): Schema.Json => {
  const attribute = record.attributes[key];
  if (attribute !== undefined) {
    // Planning Center returns equivalent timestamps with different offset notation.
    return key.endsWith("_at") && attribute !== null
      ? new Date(
          Schema.decodeUnknownSync(Schema.String)(attribute)
        ).toISOString()
      : attribute;
  }
  const relationName = key.endsWith("_ids")
    ? `${key.slice(0, -4)}s`
    : key.replace(/_id$/u, "");
  const relation = record.relationships?.[relationName];
  if (relation === undefined) {
    return null;
  }
  const { data } = Schema.decodeUnknownSync(relationshipSchema)(relation);
  if (data === null) {
    return null;
  }
  return "id" in data ? data.id : data.map((entry) => entry.id);
};

const sameValue = (left: Schema.Json, right: Schema.Json): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const attributesMatch = (
  expected: Attributes,
  actual: Attributes
): boolean =>
  Object.entries(expected).every(([key, value]) =>
    sameValue(value, actual[key] ?? null)
  );

const snapshot = (props: RecordProps, record: PcRecord): RecordAttributes => ({
  id: record.id,
  collection: props.collection,
  attributes: Object.fromEntries(
    Object.keys({ ...props.identity, ...props.attributes }).map((key) => [
      key,
      valueFor(record, key),
    ])
  ),
});

export const discoverRecord = async (
  api: SandboxApi,
  props: RecordProps,
  output?: RecordAttributes
): Promise<RecordAttributes | undefined> => {
  if (Object.keys(props.identity).length === 0) {
    throw new SandboxError(
      "Sandbox records require a nonempty stable identity."
    );
  }
  if (output !== undefined) {
    if (output.collection !== props.collection) {
      throw new SandboxError(
        "Moving managed records between collections is unsupported."
      );
    }
    const record = await api.get(`${props.collection}/${output.id}`);
    if (record !== undefined) {
      if (record.type !== props.type) {
        throw new SandboxError(
          "Managed Planning Center resource type changed."
        );
      }
      return snapshot(props, record);
    }
  }
  const records = await api.list(props.collection);
  const matches = records.filter(
    (record) =>
      record.type === props.type &&
      Object.entries(props.identity).every(([key, value]) =>
        sameValue(value, valueFor(record, key))
      )
  );
  if (matches.length > 1) {
    throw new SandboxError(
      "Ambiguous sandbox identity: refusing to adopt duplicate records."
    );
  }
  return matches[0] === undefined ? undefined : snapshot(props, matches[0]);
};

export const reconcileRecord = async (
  api: SandboxApi,
  props: RecordProps,
  output?: RecordAttributes
): Promise<RecordAttributes> => {
  const live = await discoverRecord(api, props, output);
  if (
    live !== undefined &&
    attributesMatch({ ...props.identity, ...props.attributes }, live.attributes)
  ) {
    return live;
  }
  if (live !== undefined && props.createOnly === true) {
    throw new SandboxError(
      "This Services resource cannot be updated through the public API; fix its drift in Planning Center."
    );
  }
  const saved = await api.write(
    live === undefined ? "POST" : "PATCH",
    live === undefined ? props.collection : `${props.collection}/${live.id}`,
    props.type,
    live === undefined
      ? (props.createAttributes ?? props.attributes)
      : props.attributes,
    live === undefined ? props.createRelationships : undefined
  );
  if (live === undefined && props.createAttributes !== undefined) {
    await api.write(
      "PATCH",
      `${props.collection}/${saved.id}`,
      props.type,
      props.attributes
    );
  }
  // Read back independently; do not claim success from an echoed write response.
  const verified = await api.get(`${props.collection}/${saved.id}`);
  if (
    verified === undefined ||
    !attributesMatch(
      { ...props.identity, ...props.attributes },
      snapshot(props, verified).attributes
    )
  ) {
    throw new SandboxError(
      "Planning Center did not persist the declared sandbox attributes."
    );
  }
  return snapshot(props, verified);
};

const attempt = <T>(run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      error instanceof SandboxError
        ? error
        : new SandboxError(
            "Planning Center sandbox operation failed. Check the pinned organization, API permissions, and declared fields; credentials and response bodies are suppressed."
          ),
  });

export const sandboxProviders = Provider.effect(
  SandboxRecord,
  Effect.gen(function* sandboxProvider() {
    const client = yield* Config.Redacted("PLANNING_CENTER_CLIENT").pipe(
      Effect.orDie
    );
    const token = yield* Config.Redacted("PLANNING_CENTER_PAT").pipe(
      Effect.orDie
    );
    const api = makeSandboxApi(Redacted.value(client), Redacted.value(token));
    yield* attempt(api.verify).pipe(Effect.orDie);
    return {
      stables: ["id"],
      read: ({ olds, output }) =>
        attempt(async () => await discoverRecord(api, olds, output)),
      diff: ({ news, output }) =>
        Effect.succeed(
          isResolved(news) &&
            output !== undefined &&
            news.collection === output.collection &&
            attributesMatch(
              { ...news.identity, ...news.attributes },
              output.attributes
            )
            ? ({ action: "noop" } as const)
            : ({ action: "update" } as const)
        ),
      reconcile: ({ news, output }) =>
        attempt(async () => await reconcileRecord(api, news, output)),
      // Managed test records are retained, including when a worktree loses its local state.
      delete: () => Effect.void,
    };
  })
);
