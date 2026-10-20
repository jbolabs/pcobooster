import { describe, expect, it } from "vitest";

import type { SongAttachment } from "@/hooks/use-song-attachments";
import { songRecordings } from "@/lib/song-recordings";

const audio = (
  id: string,
  keyId: string | null,
  overrides: Partial<SongAttachment> = {}
): SongAttachment => ({
  id,
  keyId,
  name: `Track ${id}`,
  filename: `${id}.mp3`,
  kind: "audio",
  contentType: "audio/mpeg",
  fileSize: null,
  linkUrl: null,
  downloadable: false,
  streamable: true,
  ...overrides,
});

describe(songRecordings, () => {
  it("offers arrangement recordings and only the selected key's playable audio", () => {
    const files = [
      audio("1", null),
      audio("2", "G"),
      audio("3", "A"),
      audio("4", "G", { streamable: false }),
      audio("5", "G", { kind: "pdf" }),
    ];
    expect(songRecordings(files, "G").map(({ id }) => id)).toStrictEqual([
      "arrangement:1",
      "G:2",
    ]);
    expect(songRecordings(files, "A").map(({ id }) => id)).toStrictEqual([
      "arrangement:1",
      "A:3",
    ]);
    expect(songRecordings(files, null).map(({ id }) => id)).toStrictEqual([
      "arrangement:1",
    ]);
  });

  it("offers validated YouTube links alongside audio, excluding other or malformed links", () => {
    const link = (id: string, linkUrl: string) =>
      audio(id, null, { kind: "link", linkUrl, streamable: false });
    expect(
      songRecordings(
        [
          audio("1", null),
          link("2", "https://youtu.be/abcdefghijk"),
          link("3", "https://youtube.com.evil.example/watch?v=abcdefghijk"),
          link("4", "https://spotify.com/track/abc"),
          link("5", "invalid URL"),
        ],
        null
      ).map(({ id, embedUrl }) => [id, embedUrl])
    ).toStrictEqual([
      ["arrangement:1", null],
      ["arrangement:2", "https://www.youtube-nocookie.com/embed/abcdefghijk"],
    ]);
  });

  it("keeps identical attachment IDs from different owners distinct", () => {
    expect(
      songRecordings([audio("1", null), audio("1", "G")], "G").map(
        ({ id }) => id
      )
    ).toStrictEqual(["arrangement:1", "G:1"]);
  });
});
