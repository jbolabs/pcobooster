import { setTimeout as delay } from "node:timers/promises";

import { Schema } from "effect";

export const sandboxOrganization = {
  id: "524200",
  name: "Jake Bodea's Org",
  timeZone: "America/Los_Angeles",
} as const;

const recordSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  attributes: Schema.Record(Schema.String, Schema.Json),
  relationships: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});
export type PcRecord = typeof recordSchema.Type;
export type Attributes = Readonly<Record<string, Schema.Json>>;
export class SandboxError extends Error {
  override name = "SandboxError";
}
const singleSchema = Schema.Struct({ data: recordSchema });
const listSchema = Schema.Struct({
  data: Schema.Array(recordSchema),
  links: Schema.optional(
    Schema.Struct({ next: Schema.optional(Schema.NullOr(Schema.String)) })
  ),
});

export interface SandboxApi {
  verify: () => Promise<PcRecord>;
  list: (collection: string) => Promise<readonly PcRecord[]>;
  get: (path: string) => Promise<PcRecord | undefined>;
  write: (
    method: "POST" | "PATCH",
    path: string,
    type: string,
    attributes: Attributes,
    relationships?: Attributes
  ) => Promise<PcRecord>;
}

const base = "https://api.planningcenteronline.com";
const servicesRoot = "/services/v2";
const allowedCollection =
  /^\/services\/v2\/(?:service_types|songs|teams|people\/\d+\/blockouts|songs\/\d+\/arrangements|service_types\/\d+\/(?:teams|plans|team_positions\/\d+\/person_team_position_assignments|plans\/\d+\/(?:plan_times|items|team_members|needed_positions))|teams\/\d+\/team_positions\/\d+\/person_team_position_assignments)$/u;
const recordId = /^\d+$/u;

export const assertSandboxOrganization = (record: PcRecord): void => {
  if (
    record.id !== sandboxOrganization.id ||
    record.attributes.name !== sandboxOrganization.name ||
    record.attributes.time_zone !== sandboxOrganization.timeZone
  ) {
    throw new SandboxError(
      "Refusing Planning Center sandbox access: organization ID, name, or time zone does not match the pinned test organization."
    );
  }
  if (record.attributes.people_allowed !== 5) {
    throw new SandboxError(
      "The sandbox must remain on the five-person Services plan."
    );
  }
};

/** Credentials stay in this closure, never in resource props, state, or error bodies. */
export const makeSandboxApi = (
  applicationId: string,
  token: string,
  transport: typeof fetch = fetch
): SandboxApi => {
  if (!applicationId || !token) {
    throw new SandboxError("Missing sandbox Planning Center credentials.");
  }
  const authorization = `Basic ${Buffer.from(`${applicationId}:${token}`).toString("base64")}`;
  let tail: Promise<null> = Promise.resolve(null);
  const request = async (
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: {
      data: {
        type: string;
        attributes: Attributes;
        relationships?: Attributes;
      };
    }
  ): Promise<Schema.Json | undefined> => {
    const previous = tail;
    const queued = Promise.withResolvers<null>();
    tail = queued.promise;
    await previous;
    try {
      const url = new URL(path, base);
      if (
        url.origin !== base ||
        (!url.pathname.startsWith(`${servicesRoot}/`) &&
          url.pathname !== servicesRoot)
      ) {
        throw new SandboxError(
          "Refusing a Planning Center request outside the Services API."
        );
      }
      const response = await transport(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-PCO-API-Version": "2018-11-01",
          "User-Agent": "pcobooster.com sandbox provisioning",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 404 && method === "GET") {
        return undefined;
      }
      if (!response.ok) {
        // Provider errors may echo request data. Report status and path only.
        throw new SandboxError(
          `Planning Center ${method} ${url.pathname}: HTTP ${response.status}`
        );
      }
      const json: unknown = await response.json();
      return Schema.decodeUnknownSync(Schema.Json)(json);
    } finally {
      await delay(250);
      queued.resolve(null);
    }
  };
  const verify = async (): Promise<PcRecord> => {
    const { data } = Schema.decodeUnknownSync(singleSchema)(
      await request("GET", servicesRoot)
    );
    assertSandboxOrganization(data);
    return data;
  };
  let verified: Promise<PcRecord> | undefined;
  const ensureVerified = async (): Promise<PcRecord> => {
    verified ??= verify();
    return await verified;
  };
  return {
    verify,
    get: async (path) => {
      await ensureVerified();
      const result = await request("GET", path);
      return result === undefined
        ? undefined
        : Schema.decodeUnknownSync(singleSchema)(result).data;
    },
    list: async (collection) => {
      await ensureVerified();
      const records: PcRecord[] = [];
      let next: string | undefined = `${collection}?per_page=100`;
      for (let page = 0; next !== undefined && page < 20; page += 1) {
        // eslint-disable-next-line no-await-in-loop -- Each page supplies the next cursor.
        const json = await request("GET", next);
        const result = Schema.decodeUnknownSync(listSchema)(json);
        records.push(...result.data);
        next = result.links?.next ?? undefined;
      }
      if (next !== undefined) {
        throw new SandboxError(
          "Sandbox pagination exceeded 20 pages; refusing incomplete discovery."
        );
      }
      return records;
    },
    write: async (method, path, type, attributes, relationships) => {
      await verify();
      const slash = path.lastIndexOf("/");
      const collection = method === "PATCH" ? path.slice(0, slash) : path;
      if (
        !allowedCollection.test(collection) ||
        (method === "PATCH" && !recordId.test(path.slice(slash + 1)))
      ) {
        throw new SandboxError(
          "This endpoint is outside the sandbox provisioning allowlist."
        );
      }
      return Schema.decodeUnknownSync(singleSchema)(
        await request(method, path, {
          data: { type, attributes, relationships },
        })
      ).data;
    },
  };
};
