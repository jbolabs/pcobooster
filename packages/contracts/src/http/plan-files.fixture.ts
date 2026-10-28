/**
 * Every combination of attachment fields Planning Center returned across a church's recent
 * plans (read on 2026-10-23), as `planFiles.list` normalizes them. Names and ids are made up;
 * the types, extensions, and flags are real. `servesPdf` is what the file's bytes turned out
 * to be, so tests can check that no PDF goes unrendered whatever its fields say.
 */
import type { PlanFile } from "@pcobooster/contracts/http/plan-files";

export interface PlanFileSample {
  readonly label: string;
  readonly file: PlanFile;
  readonly servesPdf: boolean;
}

const sample = (
  label: string,
  servesPdf: boolean,
  fields: Partial<PlanFile> &
    Pick<PlanFile, "filename" | "contentType" | "fileType" | "providerType">
): PlanFileSample => ({
  label,
  servesPdf,
  file: {
    id: label.toLowerCase().replaceAll(/[^a-z\d]+/gu, "-"),
    name: fields.filename,
    size: 0,
    hasPreview: false,
    downloadable: true,
    streamable: false,
    ownerType: "Arrangement",
    ownerId: "1",
    ...fields,
  },
});

export const PLAN_FILE_SAMPLES: readonly PlanFileSample[] = [
  sample("generated chord chart", true, {
    name: "Chord Chart in Em",
    filename: "Song - Em.pdf",
    contentType: "",
    fileType: "music",
    providerType: "AttachmentChart::Chord",
    ownerType: "Key",
  }),
  sample("generated lyrics", true, {
    name: "Lyrics",
    filename: "Song - lyrics.pdf",
    contentType: "",
    fileType: "lyric",
    providerType: "AttachmentChart::Lyric",
  }),
  sample("generated number chart", true, {
    name: "Number Chart",
    filename: "Song - number_chart.pdf",
    contentType: "",
    fileType: "music",
    providerType: "AttachmentChart::Number",
  }),
  sample("generated numeral chart", true, {
    name: "Numeral Chart",
    filename: "Song - numeral_chart.pdf",
    contentType: "",
    fileType: "music",
    providerType: "AttachmentChart::Numeral",
  }),
  sample("ChartPro chord chart", true, {
    filename: "Chord Chart.pdf",
    contentType: "application/pdf",
    fileType: "music",
    providerType: "AttachmentChartPro",
  }),
  sample("ChartPro lyrics", true, {
    filename: "Lyrics.pdf",
    contentType: "application/pdf",
    fileType: "lyric",
    providerType: "AttachmentChartPro",
  }),
  sample("PraiseCharts chart", true, {
    filename: "Song - PraiseCharts Chords & Lyrics in C.pdf",
    contentType: "application/pdf",
    fileType: "pdf",
    providerType: "AttachmentPraiseCharts",
  }),
  sample("uploaded PDF", true, {
    filename: "Song - A.pdf",
    contentType: "application/pdf",
    fileType: "pdf",
    providerType: "AttachmentS3",
  }),
  sample("uploaded PDF without a type", true, {
    filename: "Song - Bb (fixed)",
    contentType: "application/octet-stream",
    fileType: "file",
    providerType: "AttachmentS3",
  }),
  sample("uploaded archive without a type", false, {
    filename: "Song G",
    contentType: "application/octet-stream",
    fileType: "file",
    providerType: "AttachmentS3",
  }),
  sample("uploaded Word 97 document", false, {
    filename: "Song.doc",
    contentType: "application/msword",
    fileType: "file",
    providerType: "AttachmentS3",
  }),
  sample("uploaded Word document", false, {
    filename: "Song.docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileType: "file",
    providerType: "AttachmentS3",
  }),
  sample("uploaded zip", false, {
    filename: "Memos.zip",
    contentType: "application/zip",
    fileType: "zip",
    providerType: "AttachmentS3",
  }),
  sample("uploaded mp3", false, {
    filename: "Song-Alto.mp3",
    contentType: "audio/mpeg",
    fileType: "audio",
    providerType: "AttachmentS3",
    streamable: true,
  }),
  sample("uploaded m4a", false, {
    filename: "Humming.m4a",
    contentType: "audio/mp4",
    fileType: "audio",
    providerType: "AttachmentS3",
    streamable: true,
  }),
  sample("uploaded wav", false, {
    filename: "Bass.wav",
    contentType: "audio/wav",
    fileType: "audio",
    providerType: "AttachmentS3",
  }),
  sample("uploaded 3gp video", false, {
    filename: "Song-Tenor.3gp",
    contentType: "video/3gpp",
    fileType: "file",
    providerType: "AttachmentS3",
  }),
  sample("uploaded mp4 video", false, {
    filename: "Worship - Song.mp4",
    contentType: "application/mp4",
    fileType: "video",
    providerType: "AttachmentS3",
    hasPreview: true,
  }),
  sample("rehearsal mix", false, {
    name: "Original Mix (A)",
    filename: "Original Mix (A).m4a",
    contentType: "application/octet-stream",
    fileType: "audio",
    providerType: "AttachmentRehearsalMixV2",
    downloadable: false,
    streamable: true,
  }),
  sample("web link", false, {
    filename: "YouTube",
    contentType: "application/octet-stream",
    fileType: "file",
    providerType: "AttachmentLink",
  }),
  sample("YouTube video", false, {
    filename: "YouTube: Song",
    contentType: "application/octet-stream",
    fileType: "video",
    providerType: "AttachmentYoutube",
    downloadable: false,
  }),
  sample("Spotify track", false, {
    filename: "Spotify",
    contentType: "application/octet-stream",
    fileType: "audio",
    providerType: "AttachmentSpotify",
    downloadable: false,
  }),
];

/** The sample with this label; throws for a typo. */
export const planFileSample = (label: string): PlanFile => {
  const found = PLAN_FILE_SAMPLES.find((entry) => entry.label === label);
  if (found === undefined) {
    throw new Error(`No plan file sample labeled "${label}"`);
  }
  return found.file;
};
