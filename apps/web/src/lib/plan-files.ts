import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import type { PlanItem } from "@pcobooster/planning-center-models/types";

export type FileKind =
  | "pdf"
  | "audio"
  | "video"
  | "image"
  | "document"
  | "link";
export const planFileKind = (file: PlanFile): FileKind => {
  const type = file.contentType.toLowerCase();
  const filename = file.filename.toLowerCase();
  const extension = file.fileType.toLowerCase();
  if (
    type === "application/pdf" ||
    filename.endsWith(".pdf") ||
    extension === "pdf" ||
    ["AttachmentChart::Chord", "AttachmentChart::Lyric"].includes(
      file.providerType
    )
  ) {
    return "pdf";
  }
  if (
    type.startsWith("audio/") ||
    /\.(?:mp3|m4a|wav|aac|ogg|flac)$/u.test(filename) ||
    extension === "audio"
  ) {
    return "audio";
  }
  if (type.startsWith("video/") || /\.(?:mp4|mov|webm)$/u.test(filename)) {
    return "video";
  }
  if (
    type.startsWith("image/") ||
    /\.(?:png|jpe?g|gif|webp)$/u.test(filename)
  ) {
    return "image";
  }
  if (/\.(?:docx?|pptx?|xlsx?|txt|rtf|pages)$/u.test(filename)) {
    return "document";
  }
  return "link";
};
export const fileBelongsToItem = (file: PlanFile, item: PlanItem): boolean =>
  (file.ownerType === "Item" && file.ownerId === item.id) ||
  (file.ownerType === "Song" && file.ownerId === item.song?.id) ||
  (file.ownerType === "Arrangement" && file.ownerId === item.arrangement?.id) ||
  (file.ownerType === "Key" && file.ownerId === item.key?.id);
export const PLAN_LEVEL_GROUP = "Plan files";
export const fileGroupLabel = (file: PlanFile, items: PlanItem[]): string =>
  items.find((item) => fileBelongsToItem(file, item))?.title ??
  PLAN_LEVEL_GROUP;

export interface PlanFileGroup {
  label: string;
  files: PlanFile[];
}
/** Plan-wide files first, then each item's files in order-of-service order. */
export const groupPlanFiles = (
  files: PlanFile[],
  items: PlanItem[]
): PlanFileGroup[] => {
  const groups = new Map<string, PlanFile[]>([[PLAN_LEVEL_GROUP, []]]);
  for (const item of items) {
    groups.set(item.title, groups.get(item.title) ?? []);
  }
  for (const file of files) {
    const label = fileGroupLabel(file, items);
    groups.set(label, [...(groups.get(label) ?? []), file]);
  }
  const nonEmpty: PlanFileGroup[] = [];
  for (const [label, grouped] of groups) {
    if (grouped.length > 0) {
      nonEmpty.push({ label, files: grouped });
    }
  }
  return nonEmpty;
};

export type FileSection = "charts" | "audio" | "mix" | "video" | "other";
/** Section headings, in the order sections appear. */
export const fileSectionLabel: Record<FileSection, string> = {
  charts: "Charts",
  audio: "Audio",
  mix: "Rehearsal mix",
  video: "Video",
  other: "Other",
};
const sectionOrder = Object.keys(fileSectionLabel).filter(
  (section): section is FileSection => section in fileSectionLabel
);

/**
 * What a file is for, from Planning Center's attachment type. Organizations' own labels
 * cover only some rehearsal-mix parts, so they can't group every file.
 */
export const planFileSection = (file: PlanFile): FileSection => {
  if (file.providerType.startsWith("AttachmentRehearsalMix")) {
    return "mix";
  }
  const kind = planFileKind(file);
  if (file.providerType.startsWith("AttachmentChart") || kind === "pdf") {
    return "charts";
  }
  if (kind === "audio") {
    return "audio";
  }
  if (kind === "video" || file.providerType === "AttachmentYoutube") {
    return "video";
  }
  return "other";
};

/**
 * The file to open among `files`, given the one open before: the file itself, else (on
 * another song) the same part or chart by name ("Bass: Bass", "Lyrics"), else the same
 * generated chart in another key. Stepping through a set so keeps your place. Null when
 * nothing corresponds, and the first file opens instead.
 */
export const continuingFile = (
  files: PlanFile[],
  previous: PlanFile | undefined
): PlanFile | null => {
  if (previous === undefined) {
    return null;
  }
  const same = files.find((file) => file.id === previous.id);
  if (same !== undefined) {
    return same;
  }
  const byName = files.find((file) => file.name === previous.name);
  if (byName !== undefined) {
    return byName;
  }
  if (!previous.providerType.startsWith("AttachmentChart")) {
    return null;
  }
  return (
    files.find((file) => file.providerType === previous.providerType) ?? null
  );
};

/** Generated charts lead, chord before lyric; then other charts and uploads. */
const chartRank = (file: PlanFile): number => {
  const ranks = [
    "AttachmentChart::Chord",
    "AttachmentChart::Lyric",
    "AttachmentChartPro",
  ];
  const rank = ranks.indexOf(file.providerType);
  return rank === -1 ? ranks.length : rank;
};
const byName = (left: PlanFile, right: PlanFile): number =>
  left.name.localeCompare(right.name, undefined, { numeric: true });
const sectionSort: Partial<
  Record<FileSection, (left: PlanFile, right: PlanFile) => number>
> = {
  charts: (left, right) =>
    chartRank(left) - chartRank(right) || byName(left, right),
  // Full mixes first; parts are named "Instrument: Part", so name order groups them.
  mix: (left, right) =>
    Number(left.name.includes(": ")) - Number(right.name.includes(": ")) ||
    byName(left, right),
};

export interface PlanFileSection {
  section: FileSection;
  files: PlanFile[];
}
/** A song's files by section, in reading order, leaving out empty sections. */
export const sectionPlanFiles = (files: PlanFile[]): PlanFileSection[] =>
  sectionOrder.flatMap((section) => {
    const matching = files.filter((file) => planFileSection(file) === section);
    const sort = sectionSort[section];
    if (matching.length === 0) {
      return [];
    }
    return [{ section, files: sort ? matching.toSorted(sort) : matching }];
  });

/** Files in the order the browser lists them: by song, then by section. */
export const orderedPlanFiles = (
  files: PlanFile[],
  items: PlanItem[]
): PlanFile[] =>
  groupPlanFiles(files, items).flatMap((group) =>
    sectionPlanFiles(group.files).flatMap((section) => section.files)
  );

/** Embed only recognized YouTube video IDs, never an arbitrary attachment URL. */
export const youtubeEmbedUrl = (url: string): string | null => {
  const parsed = new URL(url);
  const hosts = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "www.youtu.be",
  ];
  if (parsed.protocol !== "https:" || !hosts.includes(parsed.hostname)) {
    return null;
  }
  const videoId = parsed.hostname.endsWith("youtu.be")
    ? parsed.pathname.slice(1)
    : (parsed.searchParams.get("v") ??
      /^\/(?:embed|shorts)\/(?<id>[\w-]+)$/u.exec(parsed.pathname)?.groups?.id);
  return videoId !== undefined &&
    videoId !== null &&
    /^[\w-]{11}$/u.test(videoId)
    ? `https://www.youtube-nocookie.com/embed/${videoId}`
    : null;
};
