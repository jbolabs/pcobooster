import type { EnabledFeatures } from "@pcobooster/contracts/features";
import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import {
  createFeaturesQueryOptions,
  requireFeature,
} from "@/lib/feature-query";

const setup = (answer: EnabledFeatures) => {
  const fetchFeatures = vi
    .fn<() => Promise<EnabledFeatures>>()
    .mockResolvedValue(answer);
  const options = createFeaturesQueryOptions(fetchFeatures);
  const queryClient = new QueryClient();
  const guard = async () => {
    try {
      await requireFeature(queryClient, options, "people");
      return "allowed";
    } catch (error) {
      return isNotFound(error) ? "not-found" : error;
    }
  };
  return { fetchFeatures, options, queryClient, guard };
};

describe(requireFeature, () => {
  it("asks the API and allows People when its flag is on", async () => {
    const { fetchFeatures, options, queryClient, guard } = setup({
      people: true,
      chordCharts: false,
      practice: false,
    });
    await expect(guard()).resolves.toBe("allowed");
    expect(fetchFeatures).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(options.queryKey)).toStrictEqual({
      people: true,
      chordCharts: false,
      practice: false,
    });
  });

  it("renders not found when the flag is off, whatever the other flags say", async () => {
    const { guard } = setup({
      people: false,
      chordCharts: true,
      practice: false,
    });
    await expect(guard()).resolves.toBe("not-found");
  });

  it("reuses a fresh answer, such as the one the app layout loaded", async () => {
    const { fetchFeatures, options, queryClient, guard } = setup({
      people: true,
      chordCharts: true,
      practice: false,
    });
    queryClient.setQueryData(options.queryKey, {
      people: false,
      chordCharts: true,
      practice: false,
    });
    await expect(guard()).resolves.toBe("not-found");
    expect(fetchFeatures).not.toHaveBeenCalled();
  });

  it("decides from a stale answer at once and refreshes it in the background", async () => {
    const { fetchFeatures, options, queryClient, guard } = setup({
      people: false,
      chordCharts: false,
      practice: false,
    });
    queryClient.setQueryData(
      options.queryKey,
      { people: true, chordCharts: false, practice: false },
      { updatedAt: Date.now() - 60 * 60 * 1000 }
    );
    await expect(guard()).resolves.toBe("allowed");
    expect(fetchFeatures).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(options.queryKey)).toStrictEqual({
        people: false,
        chordCharts: false,
        practice: false,
      });
    });
  });
});
