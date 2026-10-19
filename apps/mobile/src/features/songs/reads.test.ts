import {
  TransportFailure,
  makeProductClient,
} from "@pcobooster/client/product-client";
import { createRequestScheduler } from "@pcobooster/client/request-scheduler";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { arrangementRows } from "@pcobooster/planning-center-models/song-detail";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import libraryFixture from "../../harness/fixtures/songs.library.json";
import { makeControlledFixture } from "../../harness/testing/controlled-fixture";
import { chartTargets, hasChart, readChart } from "./chart";
import { songLoadFailure } from "./detail";
import { songLibraryListing, songLibrarySummary } from "./library";
import {
  prefetchSong,
  recentSongsQuery,
  rememberRecentSong,
  songChartHref,
  songHref,
  songsReads,
} from "./reads";

/** The signal of the request a test holds open. */
interface SeenRequest {
  signal: AbortSignal | null;
}

const setup = (scope = "account-a") => {
  const { transport, fetch: fixtureFetch } = makeControlledFixture();
  const requests: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    requests.push(new Request(input, init));
    return await fixtureFetch(input, init);
  });
  const client = makeProductClient({
    url: "https://fixtures.invalid",
    client: "expo",
    credentials: "omit",
    fetch,
  });
  const context = {
    client,
    scope,
    scheduler: createRequestScheduler({ quietMs: 0 }),
  };
  return { transport, fetch, requests, context, cache: new QueryClient() };
};

describe("songs reads through the product client", () => {
  it("reads the library over the wire under the account scope with decoded dates", async () => {
    const { context, cache, requests } = setup();
    const library = await cache.query(songsReads.library(context));
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(
      "/api/v1/songs/library"
    );
    expect(songsReads.library(context).queryKey).toStrictEqual([
      "account-a",
      "songs.library",
    ]);
    expect(library.truncated).toBeFalsy();
    const newMorning = library.songs.find((song) => song.id === "5534");
    expect(newMorning?.lastScheduledAt).toBeNull();
    expect(newMorning?.createdAt).toBeInstanceOf(Date);
  });

  it("reads a song's chart, history, and options at their declared paths", async () => {
    const { context, cache, requests } = setup();
    const chart = await cache.query(songsReads.chart(context, "5501"));
    await cache.query(songsReads.history(context, "5501"));
    await cache.query(songsReads.options(context, "1101", "5501"));
    expect(
      requests.map((request) => new URL(request.url).pathname)
    ).toStrictEqual([
      "/api/v1/songs/5501/chord-charts",
      "/api/v1/songs/5501/history",
      "/api/v1/service-types/1101/songs/5501/options",
    ]);
    expect(chart.song.title).toBe("Morning Light");
    expect(chart.arrangements.map((row) => row.archived)).toStrictEqual([
      false,
      true,
    ]);
  });

  it("surfaces a missing song and a permission refusal as typed faults", async () => {
    const { context, cache, transport } = setup();
    const call = vi.spyOn(transport, "handle");
    call.mockRejectedValueOnce(
      new NotFound({ message: "No song.", resource: "song" })
    );
    const chart = { ...songsReads.chart(context, "gone"), retry: false };
    await expect(cache.query(chart)).rejects.toBeInstanceOf(NotFound);
    expect(
      songLoadFailure(cache.getQueryState(chart.queryKey)?.error ?? null)
    ).toStrictEqual({ kind: "not-found" });

    call.mockRejectedValueOnce(
      new Forbidden({ message: "Your song access is None." })
    );
    const library = { ...songsReads.library(context), retry: false };
    await expect(cache.query(library)).rejects.toBeInstanceOf(Forbidden);
    expect(
      songLoadFailure(cache.getQueryState(library.queryKey)?.error ?? null)
    ).toStrictEqual({
      kind: "no-access",
      message: "Your song access is None.",
    });
  });

  it("keeps a transport failure distinct from the flag's NotFound", async () => {
    const { context, cache, transport } = setup();
    vi.spyOn(transport, "handle").mockRejectedValueOnce(
      new Error("socket closed")
    );
    const library = { ...songsReads.library(context), retry: false };
    await expect(cache.query(library)).rejects.toBeInstanceOf(Error);
    const error = cache.getQueryState(library.queryKey)?.error ?? null;
    expect(error).not.toBeInstanceOf(NotFound);
    expect(songLoadFailure(error)).toStrictEqual({ kind: "failed" });
  });

  it("aborts the request when the screen leaves before it answers", async () => {
    const { context, cache, fetch } = setup();
    const seen: SeenRequest = { signal: null };
    fetch.mockImplementationOnce(async (input, init) => {
      const { signal } = new Request(input, init);
      seen.signal = signal;
      const aborted = Promise.withResolvers<never>();
      signal.addEventListener("abort", () => {
        aborted.reject(new DOMException("Aborted", "AbortError"));
      });
      return await aborted.promise;
    });
    const options = songsReads.chart(context, "5501");
    const loading = cache.query(options).catch(() => null);
    await vi.waitFor(() => {
      expect(seen.signal).not.toBeNull();
    });
    await cache.cancelQueries({ queryKey: options.queryKey });
    await loading;
    expect(seen.signal?.aborted).toBeTruthy();
    expect(cache.getQueryData(options.queryKey)).toBeUndefined();
  });

  it("prefetches history and, with the flag, the chart in the speculative lane", async () => {
    const { context, cache, requests } = setup();
    await prefetchSong(cache, context, "5501", false);
    expect(
      requests.map((request) => new URL(request.url).pathname)
    ).toStrictEqual(["/api/v1/songs/5501/history"]);
    await prefetchSong(cache, context, "5502", true);
    expect(
      requests.slice(1).map((request) => new URL(request.url).pathname)
    ).toStrictEqual([
      "/api/v1/songs/5502/history",
      "/api/v1/songs/5502/chord-charts",
    ]);
    expect(
      requests.map((request) => request.headers.get("x-pcobooster-priority"))
    ).toStrictEqual(["speculative", "speculative", "speculative"]);
  });

  it("drops a prefetch whose intent ended before it started", async () => {
    const { context, cache, requests } = setup();
    const controller = new AbortController();
    controller.abort();
    await prefetchSong(cache, context, "5501", true, controller.signal);
    expect(requests).toStrictEqual([]);
  });
});

describe("songs partial and offline answers", () => {
  it("lists a truncated library as far as Planning Center sent it", async () => {
    const { context, cache, transport } = setup();
    const [first, second] = libraryFixture.default.songs;
    vi.spyOn(transport, "handle").mockResolvedValueOnce({
      songs: [first ?? null, second ?? null],
      truncated: true,
    });
    const library = await cache.query(songsReads.library(context));
    expect(library.truncated).toBeTruthy();
    const now = new Date("2026-10-07T18:00:00.000Z");
    const view = { filter: "all", sort: "title", query: "" } as const;
    expect(
      songLibraryListing({ songs: library.songs, recents: [], view, now })
        .listedCount
    ).toBe(2);
    expect(
      songLibrarySummary({
        songs: library.songs,
        view,
        now,
        timeZone: "America/Los_Angeles",
      })
    ).toBe("2 songs");
  });

  it("fails offline as a network transport failure, not a missing song", async () => {
    const { context, cache, fetch } = setup();
    fetch.mockRejectedValueOnce(new TypeError("Network request failed"));
    const chart = { ...songsReads.chart(context, "5501"), retry: false };
    await expect(cache.query(chart)).rejects.toBeInstanceOf(TransportFailure);
    const error = cache.getQueryState(chart.queryKey)?.error ?? null;
    expect(error instanceof TransportFailure ? error.reason : null).toBe(
      "network"
    );
    expect(songLoadFailure(error)).toStrictEqual({ kind: "failed" });
  });

  it("shows the chart's arrangements when the options read fails", async () => {
    const { context, cache, transport } = setup();
    const chart = await cache.query(songsReads.chart(context, "5504"));
    vi.spyOn(transport, "handle").mockRejectedValueOnce(
      new Forbidden({ message: "No access to this service type." })
    );
    const options = {
      ...songsReads.options(context, "1101", "5504"),
      retry: false,
    };
    await expect(cache.query(options)).rejects.toBeInstanceOf(Forbidden);
    expect(
      arrangementRows(
        cache.getQueryData(options.queryKey)?.arrangements,
        chart.arrangements
      ).map((row) => [row.id, row.archived])
    ).toStrictEqual([
      ["55041", false],
      ["55042", false],
    ]);
  });

  it("reads every fixture song's chart in every key and as lyrics", async () => {
    const { context, cache } = setup();
    const charts = await Promise.all(
      libraryFixture.default.songs.map(
        async (song) => await cache.query(songsReads.chart(context, song.id))
      )
    );
    const arrangements = charts.flatMap((chart) => chart.arrangements);
    const charted = arrangements.filter(hasChart);
    const readings = charted.flatMap((arrangement) =>
      chartTargets(arrangement).map(
        (target) => readChart(arrangement, target).lines.length
      )
    );
    expect({
      arrangements: arrangements.length,
      charted: charted.length,
      readings: readings.length,
      emptyReadings: readings.filter((lines) => lines === 0).length,
    }).toStrictEqual({
      arrangements: 36,
      charted: 9,
      readings: 24,
      emptyReadings: 0,
    });
  });
});

describe("recently opened songs", () => {
  it("keeps a newest-first list of eight per account scope", () => {
    const cache = new QueryClient();
    for (let index = 0; index < 10; index += 1) {
      rememberRecentSong(cache, "account-a", {
        id: String(index),
        title: `Song ${index}`,
        author: "",
      });
    }
    rememberRecentSong(cache, "account-a", {
      id: "5",
      title: "Song 5",
      author: "",
    });
    rememberRecentSong(cache, "demo", { id: "x", title: "Demo", author: "" });
    rememberRecentSong(cache, "demo", { id: "", title: "Blank", author: "" });
    expect(
      cache
        .getQueryData(recentSongsQuery("account-a").queryKey)
        ?.map((song) => song.id)
    ).toStrictEqual(["5", "9", "8", "7", "6", "4", "3", "2"]);
    expect(
      cache
        .getQueryData(recentSongsQuery("demo").queryKey)
        ?.map((song) => song.id)
    ).toStrictEqual(["x"]);
  });

  it("refetches as the list it already holds", async () => {
    const cache = new QueryClient();
    rememberRecentSong(cache, "account-a", { id: "1", title: "A", author: "" });
    await cache.refetchQueries();
    await expect(
      cache.query(recentSongsQuery("account-a"))
    ).resolves.toStrictEqual([{ id: "1", title: "A", author: "" }]);
    await expect(
      cache.query(recentSongsQuery("account-b"))
    ).resolves.toStrictEqual([]);
  });
});

describe("song destinations", () => {
  it("builds stable song and chart routes", () => {
    expect(songHref("5501")).toBe("/songs/5501");
    expect(songChartHref("5501")).toBe("/songs/5501/chart");
    expect(songChartHref("5501", "55011", "key-550112")).toBe(
      "/songs/5501/chart?arrangement=55011&target=key-550112"
    );
  });
});
