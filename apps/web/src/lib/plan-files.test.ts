import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { PLAN_FILE_SAMPLES } from "@pcobooster/contracts/http/plan-files.fixture";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import { describe, expect, it } from "vitest";

import {
  continuingFile,
  groupPlanFiles,
  planFileKind,
  sectionPlanFiles,
  youtubeEmbedUrl,
} from "@/lib/plan-files";

const file: PlanFile = {
  id: "1",
  name: "Chart",
  filename: "",
  contentType: "",
  fileType: "",
  providerType: "",
  size: 0,
  hasPreview: false,
  downloadable: false,
  streamable: false,
  ownerType: "Plan",
  ownerId: "1",
};
describe("Plan file types", () => {
  it("recognizes generated charts without a MIME type or extension", () => {
    expect(
      planFileKind({ ...file, providerType: "AttachmentChart::Chord" })
    ).toBe("pdf");
    expect(
      planFileKind({ ...file, providerType: "AttachmentChart::Lyric" })
    ).toBe("pdf");
  });

  it("handles uploaded documents, media, and external resources", () => {
    expect(planFileKind({ ...file, filename: "Notes.DOC" })).toBe("document");
    expect(planFileKind({ ...file, filename: "Rehearsal.MP3" })).toBe("audio");
    expect(planFileKind({ ...file, contentType: "image/png" })).toBe("image");
    expect(planFileKind({ ...file, providerType: "YouTube" })).toBe("link");
  });

  it("classifies every attachment combination Planning Center returns", () => {
    expect(
      Object.fromEntries(
        PLAN_FILE_SAMPLES.map(({ label, file: sample }) => [
          label,
          planFileKind(sample),
        ])
      )
    ).toStrictEqual({
      "generated chord chart": "pdf",
      "generated lyrics": "pdf",
      "generated number chart": "pdf",
      "generated numeral chart": "pdf",
      "ChartPro chord chart": "pdf",
      "ChartPro lyrics": "pdf",
      "PraiseCharts chart": "pdf",
      "uploaded PDF": "pdf",
      // No type but its bytes: the viewer asks for a PDF and falls back to the link.
      "uploaded PDF without a type": "unknown",
      "uploaded archive without a type": "unknown",
      "uploaded Word 97 document": "document",
      "uploaded Word document": "document",
      "uploaded zip": "link",
      "uploaded mp3": "audio",
      "uploaded m4a": "audio",
      "uploaded wav": "audio",
      "uploaded 3gp video": "video",
      "uploaded mp4 video": "video",
      "rehearsal mix": "audio",
      "web link": "link",
      "YouTube video": "link",
      "Spotify track": "link",
    });
  });

  it("asks for PDF bytes for every file that serves a PDF", () => {
    expect(
      new Set(
        PLAN_FILE_SAMPLES.filter(({ servesPdf }) => servesPdf).map(
          ({ file: sample }) => planFileKind(sample)
        )
      )
    ).toStrictEqual(new Set(["pdf", "unknown"]));
  });

  it("embeds only validated YouTube IDs on a fixed privacy domain", () => {
    expect(youtubeEmbedUrl("https://youtu.be/abcdefghijk")).toBe(
      "https://www.youtube-nocookie.com/embed/abcdefghijk"
    );
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=abcdefghijk")).toBe(
      "https://www.youtube-nocookie.com/embed/abcdefghijk"
    );
    expect(
      youtubeEmbedUrl("https://youtube.com.evil.example/watch?v=abcdefghijk")
    ).toBeNull();
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=bad")).toBeNull();
  });
});

const planItem = (id: string, title: string, songId: string): PlanItem => ({
  id,
  title,
  itemType: "song",
  sequence: Number(id),
  servicePosition: "during",
  length: null,
  description: "",
  htmlDetails: "",
  customArrangementSequence: [],
  song: { id: songId, title, author: "", themes: "", lastScheduledAt: null },
  arrangement: null,
  key: null,
  layout: null,
});

describe("Plan file groups", () => {
  it("lists plan-wide files first, then items in service order", () => {
    const items = [
      planItem("1", "Opener", "s1"),
      planItem("2", "Closer", "s2"),
    ];
    const groups = groupPlanFiles(
      [
        { ...file, id: "a", ownerType: "Song", ownerId: "s2" },
        { ...file, id: "b", ownerType: "Item", ownerId: "1" },
        { ...file, id: "c" },
      ],
      items
    );
    expect(groups.map((group) => group.label)).toStrictEqual([
      "Plan files",
      "Opener",
      "Closer",
    ]);
    expect(
      groups.map((group) => group.files.map(({ id }) => id))
    ).toStrictEqual([["c"], ["b"], ["a"]]);
  });

  it("leaves out empty groups", () => {
    expect(
      groupPlanFiles(
        [{ ...file, ownerType: "Item", ownerId: "1" }],
        [planItem("1", "Opener", "s1")]
      ).map((group) => group.label)
    ).toStrictEqual(["Opener"]);
  });
});

describe("File sections", () => {
  it("puts charts first, then audio, mix parts by instrument, and video", () => {
    const files: PlanFile[] = [
      {
        ...file,
        id: "yt",
        name: "Live video",
        providerType: "AttachmentYoutube",
      },
      {
        ...file,
        id: "keys",
        name: "Keys: Organ",
        providerType: "AttachmentRehearsalMixV2",
      },
      {
        ...file,
        id: "mp3",
        name: "Demo.mp3",
        filename: "Demo.mp3",
        providerType: "AttachmentS3",
      },
      {
        ...file,
        id: "pdf",
        name: "Lead sheet.pdf",
        filename: "Lead sheet.pdf",
        providerType: "AttachmentS3",
      },
      {
        ...file,
        id: "lyric",
        name: "Lyrics",
        providerType: "AttachmentChart::Lyric",
      },
      {
        ...file,
        id: "eg10",
        name: "Guitar: EG 10",
        providerType: "AttachmentRehearsalMixV2",
      },
      {
        ...file,
        id: "chord",
        name: "Chord Chart in G",
        providerType: "AttachmentChart::Chord",
      },
      {
        ...file,
        id: "eg2",
        name: "Guitar: EG 2",
        providerType: "AttachmentRehearsalMixV2",
      },
      {
        ...file,
        id: "doc",
        name: "Notes.doc",
        filename: "Notes.doc",
        providerType: "AttachmentS3",
      },
      {
        ...file,
        id: "full",
        name: "Original Mix",
        providerType: "AttachmentRehearsalMixV2",
      },
    ];
    expect(
      sectionPlanFiles(files).map(({ section, files: grouped }) => [
        section,
        grouped.map((grouped_) => grouped_.id),
      ])
    ).toStrictEqual([
      ["charts", ["chord", "lyric", "pdf"]],
      ["audio", ["mp3"]],
      ["mix", ["full", "eg2", "eg10", "keys"]],
      ["video", ["yt"]],
      ["other", ["doc"]],
    ]);
  });
});

describe("Continuing through a set", () => {
  const chordInE = {
    ...file,
    id: "1",
    name: "Chord Chart in E",
    providerType: "AttachmentChart::Chord",
  };
  const lyricsA = {
    ...file,
    id: "2",
    name: "Lyrics",
    providerType: "AttachmentChart::Lyric",
  };
  const bassA = {
    ...file,
    id: "3",
    name: "Bass: Bass",
    providerType: "AttachmentRehearsalMixV2",
  };

  it("opens the file itself when it is there", () => {
    const next = [
      { ...lyricsA, id: "40" },
      { ...lyricsA, id: "2" },
    ];
    expect(continuingFile(next, lyricsA)?.id).toBe("2");
  });

  it("keeps the same part or chart by name", () => {
    const next = [
      {
        ...file,
        id: "10",
        name: "Keys: Piano",
        providerType: "AttachmentRehearsalMixV2",
      },
      {
        ...file,
        id: "11",
        name: "Bass: Bass",
        providerType: "AttachmentRehearsalMixV2",
      },
    ];
    expect(continuingFile(next, bassA)?.id).toBe("11");
    expect(continuingFile([{ ...lyricsA, id: "12" }], lyricsA)?.id).toBe("12");
  });

  it("follows a generated chart into another key", () => {
    const next = [
      {
        ...file,
        id: "20",
        name: "Lyrics",
        providerType: "AttachmentChart::Lyric",
      },
      {
        ...file,
        id: "21",
        name: "Chord Chart in G",
        providerType: "AttachmentChart::Chord",
      },
    ];
    expect(continuingFile(next, chordInE)?.id).toBe("21");
  });

  it("falls back when a missing part has no counterpart", () => {
    const next = [
      {
        ...file,
        id: "30",
        name: "Keys: Piano",
        providerType: "AttachmentRehearsalMixV2",
      },
    ];
    expect(continuingFile(next, bassA)).toBeNull();
  });
});
