import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import { createBasicPlanningCenterClient } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterSongsService } from "@pcobooster/api/planning-center/services/songs-service";
import { unreachableHttpClient } from "@pcobooster/api/testing/http-client";
import { planningCenterBudgetFailures } from "@pcobooster/api/testing/planning-center-failures";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

const createCoreClientMock = () => {
  const core = createBasicPlanningCenterClient(
    testPlanningCenterToken,
    unreachableHttpClient
  );
  const fetchMock = vi.spyOn(core, "fetch");
  const fetchAllMock = vi.spyOn(core, "fetchAll");
  const fetchAllWithIncludedMock = vi.spyOn(core, "fetchAllWithIncluded");
  return { core, fetchMock, fetchAllMock, fetchAllWithIncludedMock };
};

describe(PlanningCenterSongsService, () => {
  it("dedupes song catalog loads and returns defensive clones", async () => {
    const { core } = createCoreClientMock();
    const firstPagesMock = vi.spyOn(core, "fetchFirstPages").mockReturnValue(
      Effect.succeed({
        data: [
          {
            id: "song-1",
            type: "Song",
            attributes: { title: "Build My Life" },
          },
        ],
        included: [],
        next: null,
      })
    );

    const service = new PlanningCenterSongsService(core);
    const [first, second] = await Effect.runPromise(
      Effect.all(
        [
          service.getSongsCatalogCached("account-1:service-1"),
          service.getSongsCatalogCached("account-1:service-1"),
        ],
        { concurrency: "unbounded" }
      )
    );

    expect(firstPagesMock).toHaveBeenCalledOnce();
    expect(firstPagesMock.mock.calls[0]?.slice(0, 3)).toStrictEqual([
      "/services/v2/songs",
      { order: "title" },
      15,
    ]);
    expect({
      sameContent: first,
      separateArrays: first !== second,
      separateResources: first[0] !== second[0],
    }).toStrictEqual({
      sameContent: second,
      separateArrays: true,
      separateResources: true,
    });

    first[0].attributes.title = "Changed locally";
    const third = await Effect.runPromise(
      service.getSongsCatalogCached("account-1:service-1")
    );

    expect({
      fetchCount: firstPagesMock.mock.calls.length,
      cachedTitle: second[0].attributes.title,
      laterTitle: third[0].attributes.title,
    }).toStrictEqual({
      fetchCount: 1,
      cachedTitle: "Build My Life",
      laterTitle: "Build My Life",
    });
  });
});

describe("PlanningCenterSongsService.getSongLastScheduledItem", () => {
  it("returns null for 404 responses only", async () => {
    const { core, fetchMock } = createCoreClientMock();
    fetchMock.mockReturnValueOnce(
      Effect.fail(
        new PlanningCenterApiError({
          message: "Planning Center API error: 404 - Not found",
          status: 404,
        })
      )
    );

    const service = new PlanningCenterSongsService(core);

    await expect(
      Effect.runPromise(service.getSongLastScheduledItem("song-1", "service-1"))
    ).resolves.toStrictEqual({
      data: null,
      included: [],
    });
  });

  it("rethrows non-404 Planning Center errors", async () => {
    const { core, fetchMock } = createCoreClientMock();
    const error = new PlanningCenterApiError({
      message: "Planning Center API error: 500 - Internal error",
      status: 500,
    });
    fetchMock.mockReturnValueOnce(Effect.fail(error));

    const service = new PlanningCenterSongsService(core);

    await expect(
      Effect.runPromise(
        Effect.flip(service.getSongLastScheduledItem("song-1", "service-1"))
      )
    ).resolves.toBe(error);
  });

  it.each(planningCenterBudgetFailures())(
    "fails with %s instead of reading no last item",
    async (failure) => {
      const { core, fetchMock } = createCoreClientMock();
      fetchMock.mockReturnValueOnce(Effect.fail(failure));

      const service = new PlanningCenterSongsService(core);

      await expect(
        Effect.runPromiseExit(
          service.getSongLastScheduledItem("song-1", "service-1")
        )
      ).resolves.toStrictEqual(Exit.fail(failure));
    }
  );
});
