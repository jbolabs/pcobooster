import type { TeamPositionGroup } from "@pcobooster/planning-center-models/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { neededPositionsMutationOptions } from "@/lib/needed-positions-mutation";
import { queryKeys } from "@/lib/query-keys";

const position = { id: "alto", teamId: "vocals", name: "Alto" };
const key = queryKeys.teamPositions("youth", "small-groups", null);
const setup = (open = 2) => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  client.setQueryData<TeamPositionGroup[]>(key, [
    {
      teamId: "vocals",
      teamName: "Vocals",
      positions: [{ ...position, neededCount: open, filledPendingCount: 1 }],
    },
  ]);
  return client;
};
const read = (client: QueryClient) =>
  client.getQueryData<TeamPositionGroup[]>(key)?.[0]?.positions[0];

const captureFailure = async (operation: Promise<unknown>) => {
  try {
    await operation;
    return null;
  } catch (error) {
    return error;
  }
};

describe(neededPositionsMutationOptions, () => {
  it("updates the shared count while saving and reconciles the provider's actual count", async () => {
    const client = setup();
    const response = Promise.withResolvers<{ openCount: number }>();
    response.resolve({ openCount: 4 });
    const options = neededPositionsMutationOptions(
      client,
      "youth",
      "small-groups",
      async () => {
        expect(read(client)).toMatchObject({
          name: "Alto",
          neededCount: 3,
          filledPendingCount: 1,
        });
        return await response.promise;
      },
      () => {
        throw new Error("Unexpected failure");
      }
    );
    await client
      .getMutationCache()
      .build(client, options)
      .execute({ position, change: "add" });
    expect(read(client)).toMatchObject({
      name: "Alto",
      neededCount: 4,
      filledPendingCount: 1,
    });
  });

  it("rolls a failed removal back and never invents an opening when a zero-count edit fails", async () => {
    const client = setup(0);
    let errors = 0;
    const options = neededPositionsMutationOptions(
      client,
      "youth",
      "small-groups",
      () => {
        throw new Error("Provider unavailable");
      },
      () => {
        errors += 1;
      }
    );
    await expect(
      client
        .getMutationCache()
        .build(client, options)
        .execute({ position, change: "remove" })
    ).rejects.toThrow("Provider unavailable");
    expect({ errors, position: read(client) }).toMatchObject({
      errors: 1,
      position: { name: "Alto", neededCount: 0, filledPendingCount: 1 },
    });
  });

  it("restores only a failed click while another click is queued", async () => {
    const client = setup();
    const firstWrite = Promise.withResolvers<{ openCount: number }>();
    const firstStarted = Promise.withResolvers<null>();
    let writes = 0;
    const options = neededPositionsMutationOptions(
      client,
      "youth",
      "small-groups",
      async () => {
        writes += 1;
        if (writes === 1) {
          firstStarted.resolve(null);
          return await firstWrite.promise;
        }
        expect(read(client)?.neededCount).toBe(3);
        return { openCount: 3 };
      },
      () => {}
    );
    const first = client
      .getMutationCache()
      .build(client, options)
      .execute({ position, change: "add" });
    const failure = captureFailure(first);
    await firstStarted.promise;
    const second = client
      .getMutationCache()
      .build(client, options)
      .execute({ position, change: "add" });
    firstWrite.reject(new Error("Offline"));
    await expect(failure).resolves.toMatchObject({ message: "Offline" });
    await second;
    expect(read(client)).toMatchObject({
      neededCount: 3,
      filledPendingCount: 1,
    });
  });
});
