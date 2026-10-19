import { Schema } from "effect";

interface LaneStore {
  get: (
    key: string
  ) => Promise<{ etag: string; text: () => Promise<string> } | null>;
  put: (
    key: string,
    value: string,
    options?: { onlyIf: { etagMatches?: string; etagDoesNotMatch?: string } }
  ) => Promise<{ etag: string } | null>;
  delete: (key: string) => Promise<void>;
}

export class DispatchRejectedError extends Error {
  override name = "DispatchRejectedError";
}

const laneSchema = Schema.Struct({
  build: Schema.NullOr(Schema.String),
  attempt: Schema.String,
  trigger: Schema.String,
  branch: Schema.String,
  requestedAt: Schema.Number,
});
const key = "stateful-build";

/** Authenticated operator reconciliation adopts a verified dispatch, never expires it. */
export const reconcileBuild = async (
  bucket: LaneStore,
  attempt: string,
  build: string,
  status: (build: string) => Promise<Response>
): Promise<boolean> => {
  const current = await bucket.get(key);
  if (current === null) {
    return false;
  }
  const lane = Schema.decodeUnknownSync(Schema.fromJsonString(laneSchema))(
    await current.text()
  );
  if (lane.attempt !== attempt || lane.build !== null) {
    return false;
  }
  const response = await status(build);
  if (!response.ok) {
    throw new Error("Cannot inspect reconciliation candidate");
  }
  const candidate = Schema.decodeUnknownSync(
    Schema.Struct({
      success: Schema.Boolean,
      result: Schema.Struct({
        build_uuid: Schema.String,
        created_on: Schema.String,
        trigger: Schema.Struct({ trigger_uuid: Schema.String }),
        build_trigger_metadata: Schema.Struct({ branch: Schema.String }),
      }),
    })
  )(await response.json());
  const created = Date.parse(candidate.result.created_on);
  if (
    !candidate.success ||
    candidate.result.build_uuid !== build ||
    candidate.result.trigger.trigger_uuid !== lane.trigger ||
    candidate.result.build_trigger_metadata.branch !== lane.branch ||
    !Number.isFinite(created) ||
    created < lane.requestedAt - 5000
  ) {
    throw new Error("Reconciliation candidate does not match pending dispatch");
  }
  return (
    (await bucket.put(key, JSON.stringify({ ...lane, build }), {
      onlyIf: { etagMatches: current.etag },
    })) !== null
  );
};
const statusSchema = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Struct({ status: Schema.String }),
});

/** A pending dispatch is deliberately not leased away: its API outcome may be unknown. */
export const serializedBuild = async (
  bucket: LaneStore,
  status: (build: string) => Promise<Response>,
  dispatch: () => Promise<string>,
  identity: { trigger: string; branch: string }
): Promise<boolean> => {
  const current = await bucket.get(key);
  if (current !== null) {
    const lane = Schema.decodeUnknownSync(Schema.fromJsonString(laneSchema))(
      await current.text()
    );
    if (lane.build === null) {
      throw new Error(`Dispatch ${lane.attempt} requires reconciliation`);
    }
    const response = await status(lane.build);
    if (!response.ok) {
      throw new Error("Cannot inspect active stateful build");
    }
    const active = Schema.decodeUnknownSync(statusSchema)(
      await response.json()
    );
    if (!active.success || active.result.status !== "stopped") {
      return false;
    }
  }
  const lane = {
    ...identity,
    attempt: crypto.randomUUID(),
    requestedAt: Date.now(),
    build: null,
  };
  const claim = await bucket.put(key, JSON.stringify(lane), {
    onlyIf:
      current === null
        ? { etagDoesNotMatch: "*" }
        : { etagMatches: current.etag },
  });
  if (claim === null) {
    return false;
  }
  let build: string;
  try {
    build = await dispatch();
  } catch (error) {
    if (error instanceof DispatchRejectedError) {
      await bucket.delete(key);
    }
    throw error;
  }
  await bucket.put(key, JSON.stringify({ ...lane, build }));
  return true;
};
