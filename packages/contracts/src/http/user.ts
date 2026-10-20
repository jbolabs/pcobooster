/** The signed-in person's own pcobooster.com account. */
import { write } from "@pcobooster/contracts/http/endpoint";
import { plainGroup } from "@pcobooster/contracts/http/group";
import { Schema } from "effect";

export const userDeletionSchema = Schema.Struct({
  deleted: Schema.Literal(true),
});

export const user = plainGroup(
  "user",
  /**
   * Deletes the caller's pcobooster.com account: the user, every session and linked Planning
   * Center account (with its tokens), and their feedback and activity records. The user is
   * always the session's own; nothing in Planning Center is changed. Expires the session cookies.
   */
  write.delete("delete", "/user", {
    success: userDeletionSchema,
  })
);

export type UserDeletion = typeof userDeletionSchema.Type;
