import type { ApplicationFault } from "@pcobooster/api/application/errors";
import {
  explainPlanningCenterDenial,
  withPlanningCenterFaults,
} from "@pcobooster/api/application/planning-center-access";
import { PlanningCenterSongs } from "@pcobooster/api/application/planning-center/songs";
import {
  getSongAttachmentLink,
  getSongAttachments,
} from "@pcobooster/api/modules/planning-center/song-attachments";
import type {
  SongAttachmentLink,
  SongAttachmentLinkInput,
  SongAttachments,
  SongAttachmentsInput,
} from "@pcobooster/api/modules/planning-center/song-attachments";
import { Effect } from "effect";

const viewDenied = explainPlanningCenterDenial(
  "Your Planning Center account can't view songs in Services. Ask a Services administrator for access."
);

/** An arrangement's files and its keys' files, read only. */
export const readSongAttachments = (
  input: SongAttachmentsInput
): Effect.Effect<SongAttachments, ApplicationFault, PlanningCenterSongs> =>
  Effect.gen(function* readAttachments() {
    const songsService = yield* PlanningCenterSongs;
    return yield* getSongAttachments(input, songsService);
  }).pipe(viewDenied, withPlanningCenterFaults);

/** A short-lived link to one stored file, for the device to open without credentials. */
export const readSongAttachmentLink = (
  input: SongAttachmentLinkInput
): Effect.Effect<SongAttachmentLink, ApplicationFault, PlanningCenterSongs> =>
  Effect.gen(function* openAttachment() {
    const songsService = yield* PlanningCenterSongs;
    return yield* getSongAttachmentLink(
      input,
      songsService,
      async (request, init) => await globalThis.fetch(request, init)
    );
  }).pipe(viewDenied, withPlanningCenterFaults);
