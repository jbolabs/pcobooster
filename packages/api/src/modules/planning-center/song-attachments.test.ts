import {
  MAX_ATTACHMENT_KEYS,
  getSongAttachmentLink,
  getSongAttachments,
  storedFileKind,
  toSongAttachment,
} from "@pcobooster/api/modules/planning-center/song-attachments";
import type { SongAttachmentsService } from "@pcobooster/api/modules/planning-center/song-attachments";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

const file = (
  id: string,
  attributes: PCResource["attributes"]
): PCResource => ({ id, type: "Attachment", attributes });

const key = (id: string, arrangementId: string): PCResource => ({
  id,
  type: "Key",
  attributes: { name: "Original", starting_key: "G" },
  relationships: {
    arrangement: { data: { type: "Arrangement", id: arrangementId } },
  },
});

const mp3 = file("901", {
  filename: "Morning Light - Demo.mp3",
  display_name: "Demo recording",
  content_type: "audio/mpeg",
  file_size: 4_200_000,
  pco_type: "AttachmentS3",
  downloadable: true,
  streamable: true,
});
const keyChart = file("902", {
  filename: "Morning Light (A).pdf",
  content_type: "application/pdf",
  file_size: 52_000,
  pco_type: "AttachmentS3",
  downloadable: true,
  streamable: false,
});
const rendered = file("chord_chart-550112--", {
  filename: "Morning Light.pdf",
  content_type: "application/pdf",
  pco_type: "AttachmentChart::Chord",
});

const createSongs = (keys: readonly PCResource[] = [key("550111", "55011")]) =>
  ({
    getSongArrangementsWithKeys: vi.fn<
      SongAttachmentsService["getSongArrangementsWithKeys"]
    >(() =>
      Effect.succeed({
        data: [],
        included: [...keys, key("other-key", "other-arrangement")],
      })
    ),
    getAttachmentsPage: vi.fn<SongAttachmentsService["getAttachmentsPage"]>(
      (path) =>
        Effect.succeed({
          data: path.includes("/keys/") ? [keyChart, rendered] : [mp3],
          next: null,
        })
    ),
    openChartAttachment: vi.fn<SongAttachmentsService["openChartAttachment"]>(
      () => Effect.succeed("https://files.example/signed/901?sig=abc")
    ),
  }) satisfies SongAttachmentsService;

/** Link-only opens never download the file. */
const noDownload: typeof globalThis.fetch = async () =>
  await Promise.reject(new Error("Unexpected download"));

describe(storedFileKind, () => {
  it.each([
    ["application/pdf", "chart", "pdf"],
    [null, "Lead Sheet.PDF", "pdf"],
    ["image/jpeg", "", "image"],
    ["audio/x-m4a", "", "audio"],
    [null, "click.wav", "audio"],
    ["video/quicktime", "", "video"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "",
      "document",
    ],
    [null, "chart.chopro", "document"],
    ["application/zip", "stems.zip", "other"],
  ] as const)("reads %s %s as %s", (contentType, filename, kind) => {
    expect(storedFileKind(contentType, filename)).toBe(kind);
  });
});

describe(toSongAttachment, () => {
  it("lists a stored file with its facts", () => {
    expect(toSongAttachment(mp3, null)).toStrictEqual({
      id: "901",
      keyId: null,
      name: "Demo recording",
      filename: "Morning Light - Demo.mp3",
      kind: "audio",
      contentType: "audio/mpeg",
      fileSize: 4_200_000,
      linkUrl: null,
      downloadable: true,
      streamable: true,
    });
  });

  it("lists Planning Center's chord chart and lyrics renders as PDFs it names", () => {
    const lyrics = file("lyric_chart-24342738", {
      filename: "Build Your Kingdom Here - lyrics.pdf",
      display_name: "Lyrics",
      content_type: null,
      file_size: 0,
      pco_type: "AttachmentChart::Lyric",
      downloadable: true,
    });
    expect(
      [
        toSongAttachment(rendered, "550112"),
        toSongAttachment(lyrics, null),
      ].map((attachment) => [
        attachment?.kind,
        attachment?.chart,
        attachment?.fileSize,
        attachment?.name,
      ])
    ).toStrictEqual([
      ["pdf", "chord", null, "Morning Light.pdf"],
      ["pdf", "lyrics", null, "Lyrics"],
    ]);
  });

  it("passes on a link's https address only", () => {
    const youtube = file("903", {
      pco_type: "AttachmentYoutube",
      display_name: "Live video",
      linked_url: "https://www.youtube.com/watch?v=abc",
    });
    const insecure = file("904", {
      pco_type: "AttachmentLink",
      linked_url: "http://example.com/chart",
    });
    const withCredentials = file("906", {
      pco_type: "AttachmentLink",
      linked_url: "https://user:secret@example.com/chart",
    });
    const withUserName = file("907", {
      pco_type: "AttachmentLink",
      linked_url: "https://user@example.com/chart",
    });
    expect(
      [youtube, insecure, withCredentials, withUserName].map((resource) => {
        const attachment = toSongAttachment(resource, null);
        return [attachment?.kind, attachment?.linkUrl];
      })
    ).toStrictEqual([
      ["link", "https://www.youtube.com/watch?v=abc"],
      ["link", null],
      ["link", null],
      ["link", null],
    ]);
  });

  it("reads a missing downloadable flag as allowed and a missing streamable one as not", () => {
    const bare = toSongAttachment(file("905", { filename: "a.pdf" }), null);
    expect([bare?.downloadable, bare?.streamable, bare?.name]).toStrictEqual([
      true,
      false,
      "a.pdf",
    ]);
  });
});

describe(getSongAttachments, () => {
  it("reads the arrangement's files and its own keys' files, chart renders included", async () => {
    const songs = createSongs();
    const result = await Effect.runPromise(
      getSongAttachments({ songId: "5501", arrangementId: "55011" }, songs)
    );
    expect(
      songs.getAttachmentsPage.mock.calls.map(([path]) => path)
    ).toStrictEqual([
      "/services/v2/songs/5501/arrangements/55011/attachments",
      "/services/v2/songs/5501/arrangements/55011/keys/550111/attachments",
    ]);
    expect(
      result.attachments.map(({ id, keyId, kind }) => ({ id, keyId, kind }))
    ).toStrictEqual([
      { id: "901", keyId: null, kind: "audio" },
      { id: "902", keyId: "550111", kind: "pdf" },
      { id: "chord_chart-550112--", keyId: "550111", kind: "pdf" },
    ]);
    expect(result.truncated).toBeFalsy();
  });

  it("reads at most the key limit and says the rest were not read", async () => {
    const keys = Array.from({ length: MAX_ATTACHMENT_KEYS + 2 }, (_, index) =>
      key(String(7000 + index), "55011")
    );
    const songs = createSongs(keys);
    const result = await Effect.runPromise(
      getSongAttachments({ songId: "5501", arrangementId: "55011" }, songs)
    );
    expect(songs.getAttachmentsPage).toHaveBeenCalledTimes(
      MAX_ATTACHMENT_KEYS + 1
    );
    expect(result.truncated).toBeTruthy();
  });

  it("says a collection with a next page is partial", async () => {
    const songs = createSongs([]);
    songs.getAttachmentsPage.mockReturnValue(
      Effect.succeed({
        data: [mp3],
        next: "https://api.planningcenteronline.com/next",
      })
    );
    const result = await Effect.runPromise(
      getSongAttachments({ songId: "5501", arrangementId: "55011" }, songs)
    );
    expect(result.truncated).toBeTruthy();
  });

  it("refuses ids that could walk the API path before any request", async () => {
    const songs = createSongs();
    const exit = await Effect.runPromiseExit(
      getSongAttachments(
        { songId: "5501", arrangementId: "../../people/v2/people" },
        songs
      )
    );
    expect(Exit.isFailure(exit) && JSON.stringify(exit)).toContain("NotFound");
    expect(songs.getSongArrangementsWithKeys).not.toHaveBeenCalled();
  });
});

describe(getSongAttachmentLink, () => {
  it("returns a PDF's bytes from Planning Center's storage, so the app shows it", async () => {
    const songs = createSongs();
    songs.openChartAttachment.mockReturnValue(
      Effect.succeed("https://pco-files.s3.amazonaws.com/901.pdf?sig=abc")
    );
    const link = await Effect.runPromise(
      getSongAttachmentLink(
        {
          songId: "5501",
          arrangementId: "55011",
          attachmentId: "901",
          as: "pdf",
        },
        songs,
        async () => await Promise.resolve(new Response("%PDF-1.7 chart"))
      )
    );
    expect(link).toStrictEqual({
      url: "https://pco-files.s3.amazonaws.com/901.pdf?sig=abc",
      // base64 of "%PDF-1.7 chart"
      data: "JVBERi0xLjcgY2hhcnQ=",
    });
  });

  it("answers with the link alone when the file asked for as a PDF isn't one", async () => {
    const songs = createSongs();
    songs.openChartAttachment.mockReturnValue(
      Effect.succeed("https://pco-files.s3.amazonaws.com/901?sig=abc")
    );
    const link = await Effect.runPromise(
      getSongAttachmentLink(
        {
          songId: "5501",
          arrangementId: "55011",
          attachmentId: "901",
          as: "pdf",
        },
        songs,
        async () => await Promise.resolve(new Response("<html>login</html>"))
      )
    );
    expect(link).toStrictEqual({
      url: "https://pco-files.s3.amazonaws.com/901?sig=abc",
    });
  });

  it("opens an arrangement's file or a key's file at its own path", async () => {
    const songs = createSongs();
    const link = await Effect.runPromise(
      getSongAttachmentLink(
        { songId: "5501", arrangementId: "55011", attachmentId: "901" },
        songs,
        noDownload
      )
    );
    await Effect.runPromise(
      getSongAttachmentLink(
        {
          songId: "5501",
          arrangementId: "55011",
          attachmentId: "902",
          keyId: "550111",
        },
        songs,
        noDownload
      )
    );
    expect(
      songs.openChartAttachment.mock.calls.map(([path]) => path)
    ).toStrictEqual([
      "/services/v2/songs/5501/arrangements/55011/attachments/901",
      "/services/v2/songs/5501/arrangements/55011/keys/550111/attachments/902",
    ]);
    expect(link).toStrictEqual({
      url: "https://files.example/signed/901?sig=abc",
    });
  });

  it("never opens a crafted id: open is a POST the read-only demo allows", async () => {
    const songs = createSongs();
    const exits = await Promise.all(
      [
        { attachmentId: "../../../../people/v2/people/1" },
        { attachmentId: "901", keyId: "1/../../2" },
        { attachmentId: "901?x=1" },
      ].map(
        async (ids) =>
          await Effect.runPromiseExit(
            getSongAttachmentLink(
              { songId: "5501", arrangementId: "55011", ...ids },
              songs,
              noDownload
            )
          )
      )
    );
    expect(exits.every(Exit.isFailure)).toBeTruthy();
    expect(songs.openChartAttachment).not.toHaveBeenCalled();
  });

  it("refuses a link that is not https", async () => {
    const songs = createSongs();
    songs.openChartAttachment.mockReturnValue(
      Effect.succeed("http://files.example/901")
    );
    const exit = await Effect.runPromiseExit(
      getSongAttachmentLink(
        { songId: "5501", arrangementId: "55011", attachmentId: "901" },
        songs,
        noDownload
      )
    );
    expect(JSON.stringify(exit)).toContain("secure link");
  });

  it("refuses a signed link with an embedded user name or password", async () => {
    const songs = createSongs();
    songs.openChartAttachment.mockReturnValue(
      Effect.succeed("https://user:secret@files.example/901?sig=abc")
    );
    const exit = await Effect.runPromiseExit(
      getSongAttachmentLink(
        { songId: "5501", arrangementId: "55011", attachmentId: "901" },
        songs,
        noDownload
      )
    );
    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(JSON.stringify(exit)).toContain("secure link");
    expect(JSON.stringify(exit)).not.toContain("secret");
  });
});

describe("RehearsalMix attachments", () => {
  it("recognizes RehearsalMix streams without file metadata and preserves access flags", () => {
    expect(
      toSongAttachment(
        file("904", {
          pco_type: "AttachmentRehearsalMixV2",
          display_name: "Keys: Piano",
          streamable: true,
          downloadable: false,
        }),
        "550111"
      )
    ).toMatchObject({
      id: "904",
      keyId: "550111",
      name: "Keys: Piano",
      kind: "audio",
      streamable: true,
      downloadable: false,
    });
  });
});
