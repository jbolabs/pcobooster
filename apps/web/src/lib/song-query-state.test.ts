import type { ChordChartArrangement } from "@pcobooster/contracts/http/chord-charts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/lib/query-keys";
import {
  rememberWrittenArrangement,
  settleSongCreation,
} from "@/lib/song-query-state";

const arrangement: ChordChartArrangement = {
  id: "21",
  name: "Full band",
  archived: false,
  chordChart: "[D]Morning",
  chordChartKey: "D",
  lyrics: "Morning",
  keys: [],
  updatedAt: "2026-10-19T00:00:00Z",
  length: null,
  bpm: null,
  meter: null,
  sequence: [],
  notes: null,
  layout: {
    font: null,
    fontSize: null,
    columns: null,
    chordColor: null,
    pageSize: null,
    orientation: null,
    margin: null,
  },
};

describe("song cache freshness", () => {
  it("refreshes the library, warm searches, and suggestions when song creation settles", async () => {
    const client = new QueryClient();
    let catalog = ["Morning"];
    const observers = [
      queryKeys.songLibrary(),
      queryKeys.songSearch("Evening"),
      queryKeys.songSuggestions(),
    ].map(
      (queryKey) =>
        new QueryObserver(client, {
          queryKey,
          queryFn: () => catalog,
          staleTime: Infinity,
        })
    );
    const stop = observers.map((observer) => observer.subscribe(() => {}));
    await Promise.all(
      observers.map(async (observer) => await observer.refetch())
    );
    catalog = ["Evening", "Morning"];
    settleSongCreation(client);
    await Promise.all(
      observers.map(
        async (observer) => await observer.getCurrentQuery().promise
      )
    );
    expect(
      observers.map((observer) => observer.getCurrentResult().data)
    ).toStrictEqual([
      ["Evening", "Morning"],
      ["Evening", "Morning"],
      ["Evening", "Morning"],
    ]);
    for (const unsubscribe of stop) {
      unsubscribe();
    }
    client.clear();
  });

  it("updates the editor and refreshes the plan's files and choices after saving a chart", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.chordChartSong("20"), {
      song: { id: "20", title: "Morning", author: "Sandbox" },
      arrangements: [],
    });
    let saved = "Acoustic";
    const observers = [
      queryKeys.planFiles("30", "31"),
      queryKeys.planFileLink("30", "31", "40", "pdf"),
      queryKeys.songOptions("20", "30"),
      queryKeys.songHistory("20"),
    ].map(
      (queryKey) =>
        new QueryObserver(client, {
          queryKey,
          queryFn: () => saved,
          staleTime: Infinity,
        })
    );
    const stop = observers.map((observer) => observer.subscribe(() => {}));
    await Promise.all(
      observers.map(async (observer) => await observer.refetch())
    );
    saved = "Full band";
    rememberWrittenArrangement(client, "20", arrangement);
    await Promise.all(
      observers.map(
        async (observer) => await observer.getCurrentQuery().promise
      )
    );
    expect(
      observers.map((observer) => observer.getCurrentResult().data)
    ).toStrictEqual(["Full band", "Full band", "Full band", "Full band"]);
    expect(client.getQueryData(queryKeys.chordChartSong("20"))).toMatchObject({
      arrangements: [{ name: "Full band", chordChartKey: "D" }],
    });
    for (const unsubscribe of stop) {
      unsubscribe();
    }
    client.clear();
  });
});
