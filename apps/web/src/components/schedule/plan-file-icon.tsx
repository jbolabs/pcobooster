import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import {
  AudioLines,
  Clapperboard,
  File,
  FileMusic,
  FileText,
  Image,
  Link2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { planFileKind } from "@/lib/plan-files";
import type { FileKind } from "@/lib/plan-files";

const kindIcon: Record<FileKind, LucideIcon> = {
  pdf: FileText,
  audio: AudioLines,
  video: Clapperboard,
  image: Image,
  document: FileText,
  link: Link2,
  unknown: File,
};

const isChart = (file: PlanFile) =>
  file.providerType.startsWith("AttachmentChart");

/** A file's type at a glance: generated charts get a music page, everything else its kind. */
export const PlanFileIcon = ({
  file,
  className,
}: {
  file: PlanFile;
  className?: string;
}) => {
  const Icon = isChart(file) ? FileMusic : kindIcon[planFileKind(file)];
  return <Icon aria-hidden className={className} />;
};

/** The icon in a rounded tile, for list rows and empty states. */
export const PlanFileIconTile = ({
  file,
  size = "sm",
}: {
  file: PlanFile;
  size?: "sm" | "lg";
}) => (
  <span
    className={
      size === "lg"
        ? "bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-2xl"
        : "bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg"
    }
  >
    <PlanFileIcon file={file} className={size === "lg" ? "size-6" : "size-4"} />
  </span>
);
