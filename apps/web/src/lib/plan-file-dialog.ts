import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import type {
  PlanItem,
  PlanItemSong,
} from "@pcobooster/planning-center-models/types";

export type SongItem = PlanItem & { song: PlanItemSong };

/** The item whose files the dialog shows, and the file it opens on. */
export interface PlanFileDialogState {
  itemId: string;
  file: PlanFile;
}

/** The plan's songs, in service order. */
export const songItemsOf = (items: readonly PlanItem[]): SongItem[] =>
  items.filter((item): item is SongItem => item.song !== null);
