import { describe, expect, it } from "vitest";

import { makeSandboxApi } from "./api";
import type { PcRecord, SandboxApi } from "./api";
import { reconcileRecord } from "./resources";

const definition = {
  collection: "/services/v2/service_types",
  type: "ServiceType",
  identity: { name: "Agent Sandbox • Sunday" },
  attributes: { name: "Agent Sandbox • Sunday" },
};

const makeProvider = (initial: PcRecord[]) => {
  const records = [...initial];
  const writes: string[] = [];
  const api: SandboxApi = {
    verify: async () =>
      await Promise.resolve({
        id: "524200",
        type: "Organization",
        attributes: {},
      }),
    list: async () => await Promise.resolve(records),
    get: async (path) =>
      await Promise.resolve(
        records.find((record) => path.endsWith(`/${record.id}`))
      ),
    write: async (method, path, type, attributes) => {
      writes.push(`${method} ${path}`);
      const id = method === "POST" ? "101" : (path.split("/").at(-1) ?? "");
      const record = { id, type, attributes };
      const previous = records.findIndex((entry) => entry.id === id);
      if (previous === -1) {
        records.push(record);
      } else {
        records[previous] = record;
      }
      return await Promise.resolve(record);
    },
  };
  return { api, records, writes };
};

describe("Planning Center sandbox reconciliation", () => {
  it("creates once and rediscovers the same record without local Alchemy state", async () => {
    const provider = makeProvider([]);
    const first = await reconcileRecord(provider.api, definition);
    const recovered = await reconcileRecord(provider.api, definition);
    expect([
      first.id,
      recovered.id,
      provider.writes,
      provider.records,
    ]).toStrictEqual([
      "101",
      "101",
      ["POST /services/v2/service_types"],
      [
        {
          id: "101",
          type: "ServiceType",
          attributes: { name: "Agent Sandbox • Sunday" },
        },
      ],
    ]);
  });

  it("restores drift using the tracked ID", async () => {
    const provider = makeProvider([
      {
        id: "99",
        type: "ServiceType",
        attributes: { name: "Changed in the UI" },
      },
    ]);
    const restored = await reconcileRecord(provider.api, definition, {
      id: "99",
      collection: definition.collection,
      attributes: {},
    });
    expect([restored, provider.writes]).toStrictEqual([
      {
        id: "99",
        collection: "/services/v2/service_types",
        attributes: { name: "Agent Sandbox • Sunday" },
      },
      ["PATCH /services/v2/service_types/99"],
    ]);
  });

  it("rejects ambiguous adoption", async () => {
    const provider = makeProvider([
      { id: "1", type: "ServiceType", attributes: definition.attributes },
      { id: "2", type: "ServiceType", attributes: definition.attributes },
    ]);
    await expect(reconcileRecord(provider.api, definition)).rejects.toThrow(
      "Ambiguous sandbox identity"
    );
  });

  it("checks persistence independently of the write response", async () => {
    const provider = makeProvider([]);
    provider.api.get = async () =>
      await Promise.resolve({
        id: "101",
        type: "ServiceType",
        attributes: { name: "Not persisted" },
      });
    await expect(reconcileRecord(provider.api, definition)).rejects.toThrow(
      "did not persist"
    );
  });
});

describe("sandbox credential boundaries", () => {
  it("rejects a church credential before making any mutation", async () => {
    const requests: string[] = [];
    const transport: typeof fetch = async (input, init) => {
      requests.push(
        `${init?.method} ${input instanceof URL ? input.href : "unexpected request"}`
      );
      return await Promise.resolve(
        Response.json({
          data: {
            id: "church",
            type: "Organization",
            attributes: {
              name: "Actual Church",
              time_zone: "America/Los_Angeles",
              people_allowed: 5,
            },
          },
        })
      );
    };
    const api = makeSandboxApi("client", "secret", transport);
    await expect(
      api.write(
        "POST",
        definition.collection,
        definition.type,
        definition.attributes
      )
    ).rejects.toThrow("does not match");
    expect(requests).toStrictEqual([
      "GET https://api.planningcenteronline.com/services/v2",
    ]);
  });

  it("rejects paid capacity", async () => {
    const paidCapacity = 20;
    const transport: typeof fetch = async () =>
      await Promise.resolve(
        Response.json({
          data: {
            id: "524200",
            type: "Organization",
            attributes: {
              name: "Jake Bodea's Org",
              time_zone: "America/Los_Angeles",
              people_allowed: paidCapacity,
            },
          },
        })
      );
    await expect(
      makeSandboxApi("client", "secret", transport).verify()
    ).rejects.toThrow("five-person Services plan");
  });
});
