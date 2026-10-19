import { Schema } from "effect";

import type { LaneStore } from "./serialized";
import { serializedBuild } from "./serialized";

const requestSchema = Schema.Struct({
  id: Schema.String,
  trigger: Schema.String,
  branch: Schema.String,
  sha: Schema.optional(Schema.String),
});
type BuildRequest = typeof requestSchema.Type;
export const enqueueBuild = async (
  store: LaneStore,
  lane: "release" | "maintenance",
  request: Omit<BuildRequest, "id">
): Promise<void> => {
  await store.put(
    `queue/${lane}`,
    JSON.stringify({ ...request, id: crypto.randomUUID() })
  );
};

/** Keep the latest request while another build runs; acknowledgements never erase newer work. */
export const drainBuilds = async (
  store: LaneStore,
  status: (build: string) => Promise<Response>,
  dispatch: (request: BuildRequest) => Promise<string>
): Promise<void> => {
  for (const lane of ["release", "maintenance"]) {
    // Queue priority and stateful mutations must be inspected in order.
    // oxlint-disable-next-line no-await-in-loop
    const entry = await store.get(`queue/${lane}`);
    if (entry === null) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- decode the current queue entry before dispatch
    const request = Schema.decodeUnknownSync(
      Schema.fromJsonString(requestSchema)
    )(
      // oxlint-disable-next-line no-await-in-loop -- decode before dispatching this queue entry
      await entry.text()
    );
    // oxlint-disable-next-line no-await-in-loop -- compare acknowledgement for this lane
    const acknowledged = await store.get(`ack/${lane}`);
    // oxlint-disable-next-line no-await-in-loop -- read acknowledgement before conditional dispatch
    if (acknowledged !== null && (await acknowledged.text()) === request.id) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- only one stateful build may dispatch
    const started = await serializedBuild(
      store,
      status,
      async () => await dispatch(request),
      request
    );
    if (started) {
      // oxlint-disable-next-line no-await-in-loop -- acknowledge only this request, leaving newer requests queued
      await store.put(`ack/${lane}`, request.id);
    }
    return;
  }
};
