import type { PlanFileOpenInput } from "@pcobooster/contracts/http/plan-files";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlanFileQueryOptions } from "@/lib/plan-file-query";

const input: PlanFileOpenInput = {
  serviceTypeId: "1",
  planId: "2",
  attachmentId: "3",
  as: "pdf",
};

describe("plan file query cache", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
    client = new QueryClient();
  });

  afterEach(() => {
    client.clear();
    vi.useRealTimers();
  });

  it("reuses a downloaded PDF after its reader unmounts and another file opens", async () => {
    let downloads = 0;
    const options = createPlanFileQueryOptions(input, () => {
      downloads += 1;
      return {
        url: `https://files.example/${downloads}`,
        data: "JVBERi0x",
        preview: false,
      };
    });
    const reader = new QueryObserver(client, options);
    const stop = reader.subscribe(() => {});
    await reader.getCurrentQuery().promise;
    stop();
    await client.query(
      createPlanFileQueryOptions({ ...input, attachmentId: "4" }, () => ({
        url: "https://files.example/other",
        data: "JVBERi0y",
        preview: false,
      }))
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(client.query(options)).resolves.toStrictEqual({
      url: "https://files.example/1",
      data: "JVBERi0x",
      preview: false,
    });
    expect(downloads).toBe(1);
  });

  it.each(["link", "preview", "pdf"] as const)(
    "refreshes %s answers without PDF bytes",
    async (as) => {
      let opens = 0;
      const options = createPlanFileQueryOptions({ ...input, as }, () => {
        opens += 1;
        return {
          url: `https://files.example/${opens}`,
          preview: as !== "link",
        };
      });
      await client.query(options);
      await expect(client.query(options)).resolves.toStrictEqual({
        url: "https://files.example/2",
        preview: as !== "link",
      });
    }
  );

  it("fetches changed PDF bytes after five minutes", async () => {
    let data = "JVBERi0x";
    const options = createPlanFileQueryOptions(input, () => ({
      url: "https://files.example/chart",
      data,
      preview: false,
    }));
    const reader = new QueryObserver(client, options);
    const stop = reader.subscribe(() => {});
    await reader.getCurrentQuery().promise;
    data = "JVBERi0y";
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await expect(client.query(options)).resolves.toMatchObject({
      data: "JVBERi0y",
    });
    stop();
  });

  it("evicts inactive PDF bytes after five minutes", async () => {
    let data = "JVBERi0x";
    const options = createPlanFileQueryOptions(input, () => ({
      url: "https://files.example/chart",
      data,
      preview: false,
    }));
    await client.query(options);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    data = "JVBERi0y";
    await expect(client.query(options)).resolves.toMatchObject({
      data: "JVBERi0y",
    });
  });

  it("gets a fresh original link without downloading the cached PDF again", async () => {
    const pdf = createPlanFileQueryOptions(input, () => ({
      url: "https://files.example/expired",
      data: "JVBERi0x",
      preview: false,
    }));
    await client.query(pdf);
    const original = createPlanFileQueryOptions(
      { ...input, as: "link" },
      () => ({
        url: "https://files.example/fresh",
        preview: false,
      })
    );
    await expect(client.query(original)).resolves.toStrictEqual({
      url: "https://files.example/fresh",
      preview: false,
    });
    await expect(client.query(pdf)).resolves.toMatchObject({
      data: "JVBERi0x",
    });
  });

  it("forgets the PDF when the account session cache is cleared", async () => {
    let data = "JVBERi0x";
    const options = createPlanFileQueryOptions(input, () => ({
      url: "https://files.example/chart",
      data,
      preview: false,
    }));
    await client.query(options);
    client.clear();
    data = "JVBERi0y";
    await expect(client.query(options)).resolves.toMatchObject({
      data: "JVBERi0y",
    });
  });
});
