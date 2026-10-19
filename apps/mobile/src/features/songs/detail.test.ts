import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { describe, expect, it } from "vitest";

import {
  keyOptionLabel,
  songIdentity,
  songLoadFailure,
  songScreenFailure,
} from "./detail";

describe(keyOptionLabel, () => {
  it("labels keys by name and starting key", () => {
    expect(
      keyOptionLabel({
        id: "k",
        name: "Jordan's key",
        startingKey: "Bb",
        endingKey: null,
      })
    ).toBe("Jordan's key (B♭)");
    expect(
      keyOptionLabel({ id: "k", name: "", startingKey: null, endingKey: null })
    ).toBe("No key");
  });
});

const failed = (error: Error) => ({ status: "error" as const, error });

describe("song load failures", () => {
  const pending = { status: "pending" as const, error: null };

  it("maps faults to what would help", () => {
    expect(
      songLoadFailure(new NotFound({ message: "gone", resource: "song" }))
    ).toStrictEqual({
      kind: "not-found",
    });
    expect(
      songLoadFailure(new Forbidden({ message: "Needs Viewer access." }))
    ).toStrictEqual({ kind: "no-access", message: "Needs Viewer access." });
    expect(songLoadFailure(new Error("offline"))).toStrictEqual({
      kind: "failed",
    });
  });

  it("fails the whole screen only when nothing names the song and every read failed", () => {
    const notFound = new NotFound({ message: "gone", resource: "song" });
    expect(
      songScreenFailure({
        titleKnown: false,
        history: failed(new Error("offline")),
        options: null,
        chart: failed(notFound),
      })
    ).toStrictEqual({ kind: "not-found" });
    expect(
      songScreenFailure({
        titleKnown: false,
        history: failed(new Error("offline")),
        options: null,
        chart: pending,
      })
    ).toBeNull();
    expect(
      songScreenFailure({
        titleKnown: true,
        history: failed(new Error("offline")),
        options: null,
        chart: failed(notFound),
      })
    ).toBeNull();
  });
});

describe(songIdentity, () => {
  it("names the song from the first read that knows it, with trimmed themes", () => {
    expect(
      songIdentity(
        [
          undefined,
          { title: "  ", author: "Maya Ellison" },
          { title: "Later", author: "" },
        ],
        "Praise, , Morning "
      )
    ).toStrictEqual({
      title: "Untitled song",
      rawTitle: "  ",
      author: "Maya Ellison",
      themes: ["Praise", "Morning"],
    });
    expect(songIdentity([undefined], "")).toStrictEqual({
      title: null,
      rawTitle: null,
      author: "",
      themes: [],
    });
  });
});
