import {
  PLAN_FILE_LINK_TYPES,
  planFileDeclaresPdf,
  planFileIsUntyped,
} from "@pcobooster/contracts/http/plan-files";
import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import type { PlanItem } from "@pcobooster/planning-center-models/types";

/** `unknown`: Planning Center gives no type, so the preview asks for a PDF and falls back to the link. */
export type PlanFileKind =
  | "pdf"
  | "audio"
  | "video"
  | "document"
  | "link"
  | "unknown";
const AUDIO_FILE = /\.(?:mp3|m4a|wav|aac|ogg|flac)$/u;
const VIDEO_FILE = /\.(?:mp4|mov|webm)$/u;
const DOCUMENT_FILE =
  /\.(?:png|jpe?g|gif|webp|docx?|pptx?|xlsx?|txt|rtf|pages)$/u;

export const planFileKind = (file: PlanFile): PlanFileKind => {
  const type = file.contentType.toLowerCase();
  const filename = file.filename.toLowerCase();
  if (planFileDeclaresPdf(file)) {
    return "pdf";
  }
  if (PLAN_FILE_LINK_TYPES.has(file.providerType)) {
    return "link";
  }
  if (type.startsWith("audio/") || AUDIO_FILE.test(filename)) {
    return "audio";
  }
  if (type.startsWith("video/") || VIDEO_FILE.test(filename)) {
    return "video";
  }
  if (type.startsWith("image/") || DOCUMENT_FILE.test(filename)) {
    return "document";
  }
  return planFileIsUntyped(file) ? "unknown" : "link";
};

export interface PlanFileGroup {
  readonly id: string;
  readonly title: string;
  readonly files: PlanFile[];
}

/** Keep identical song titles distinct, and put shared files beside their first use. */
export const groupPlanFiles = (
  files: readonly PlanFile[],
  items: readonly PlanItem[]
): PlanFileGroup[] => {
  const plan: PlanFileGroup = { id: "plan", title: "Plan files", files: [] };
  const groups = new Map<string, PlanFileGroup>(
    items.map((item) => [
      item.id,
      {
        id: item.id,
        title: item.title || "Untitled item",
        files: [],
      },
    ])
  );
  for (const file of files) {
    const item = items.find(
      (candidate) =>
        (file.ownerType === "Item" && file.ownerId === candidate.id) ||
        (file.ownerType === "Song" && file.ownerId === candidate.song?.id) ||
        (file.ownerType === "Arrangement" &&
          file.ownerId === candidate.arrangement?.id) ||
        (file.ownerType === "Key" && file.ownerId === candidate.key?.id)
    );
    const group = item === undefined ? plan : (groups.get(item.id) ?? plan);
    group.files.push(file);
  }
  return [plan, ...groups.values()].filter((group) => group.files.length > 0);
};
