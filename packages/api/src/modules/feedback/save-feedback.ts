import type { Db } from "@pcobooster/api/db/client";
import { feedback } from "@pcobooster/api/db/schema";
import type { FeedbackSubmission } from "@pcobooster/api/modules/feedback/submit-feedback";
import { sql } from "drizzle-orm";

export const saveFeedback = async (
  database: Db,
  submission: FeedbackSubmission,
  allowMissingUser = false
): Promise<{ id: number }> => {
  // A deletion can commit after authentication but before this write. Check user existence
  // in the insert itself so a stale or in-flight request cannot recreate deleted personal data.
  // The local PAT bypass has no database user; only its application adapter opts out.
  const [row] = allowMissingUser
    ? await database
        .insert(feedback)
        .values(submission)
        .returning({ id: feedback.id })
    : await database.all<{ id: number }>(sql`
        insert into feedback (user_id, message, path, posthog_session_id, user_agent)
        select ${submission.userId}, ${submission.message}, ${submission.path},
               ${submission.sessionId}, ${submission.userAgent}
        where exists (select 1 from user where id = ${submission.userId})
        returning id
      `);
  if (row === undefined) {
    throw new Error("Feedback insert returned no row");
  }
  return row;
};
