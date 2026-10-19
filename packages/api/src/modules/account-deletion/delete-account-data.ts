/**
 * Everything pcobooster.com stores for one user, deleted in one D1 batch (a single transaction:
 * all of it or none). Planning Center's own records are never touched.
 *
 * - `user`, and every `session` (web and native) and linked `account` with its OAuth tokens
 * - `planning_center_account_identities` for those accounts (name, email, organization)
 * - `feedback` they sent and `activity_events` they caused (by user or by linked account)
 * - unredeemed native sign-in handoffs for them in `verification`
 *
 * The same batch records an `analytics_erasure_requests` row (only when the user existed), so the
 * PostHog erasure owed for this deletion can never be lost between two writes; `analytics-erasure.ts`
 * carries it out after a grace period. Each table is deleted explicitly rather than through
 * `ON DELETE CASCADE`, so the result never depends on the connection enforcing foreign keys. Workers
 * Logs and short-lived caches are not reachable from here and expire on their own.
 */
import { HANDOFF_IDENTIFIER_PREFIX } from "@pcobooster/api/auth/native-sign-in";
import type { Db } from "@pcobooster/api/db/client";
import {
  account,
  activityEvents,
  analyticsErasureRequests,
  feedback,
  planningCenterAccountIdentities,
  session,
  user,
  verification,
} from "@pcobooster/api/db/schema";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";

import { firstErasurePassAt } from "./analytics-erasure";

export interface DeletedAccountData {
  /** False when the user was already gone (a concurrent deletion). */
  readonly userDeleted: boolean;
  readonly sessions: number;
  readonly accounts: number;
  readonly feedback: number;
  readonly activityEvents: number;
  /** Whether a PostHog erasure was queued (false when the user was already gone). */
  readonly analyticsErasureQueued: boolean;
}

export const deleteAccountData = async (
  database: Db,
  userId: string,
  requestedAt: Date
): Promise<DeletedAccountData> => {
  // Insert-select on the user row, ahead of its deletion: exactly one request per deleted user,
  // even when two deletions race.
  const queueErasure = database.all<{ id: number }>(sql`
    insert into ${analyticsErasureRequests}
      (distinct_id, requested_at, next_attempt_at, passes_completed, failed_attempts)
    select ${user.id}, ${requestedAt.getTime()}, ${firstErasurePassAt(requestedAt).getTime()}, 0, 0
    from ${user} where ${user.id} = ${userId}
    returning id`);
  const linkedAccountIds = database
    .select({ id: account.id })
    .from(account)
    .where(eq(account.userId, userId));
  const deleteActivity = database
    .delete(activityEvents)
    .where(
      or(
        eq(activityEvents.actorUserId, userId),
        inArray(activityEvents.actorAccountId, linkedAccountIds)
      )
    )
    .returning({ id: activityEvents.id });
  const deleteFeedback = database
    .delete(feedback)
    .where(eq(feedback.userId, userId))
    .returning({ id: feedback.id });
  const deleteHandoffs = database
    .delete(verification)
    .where(
      and(
        like(verification.identifier, `${HANDOFF_IDENTIFIER_PREFIX}%`),
        // Handoff values are JSON; anything else in the table is skipped, never an error.
        sql`case when json_valid(${verification.value}) then json_extract(${verification.value}, '$.userId') end = ${userId}`
      )
    )
    .returning({ id: verification.id });
  const deleteIdentities = database
    .delete(planningCenterAccountIdentities)
    .where(inArray(planningCenterAccountIdentities.accountId, linkedAccountIds))
    .returning({ id: planningCenterAccountIdentities.accountId });
  const deleteSessions = database
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id });
  const deleteAccounts = database
    .delete(account)
    .where(eq(account.userId, userId))
    .returning({ id: account.id });
  const deleteUser = database
    .delete(user)
    .where(eq(user.id, userId))
    .returning({ id: user.id });
  const [erasure, activity, , feedbackRows, , sessions, accounts, users] =
    await database.batch([
      queueErasure,
      // Both read the linked accounts, so they run before those go.
      deleteActivity,
      deleteIdentities,
      deleteFeedback,
      deleteHandoffs,
      deleteSessions,
      deleteAccounts,
      deleteUser,
    ]);
  return {
    userDeleted: users.length > 0,
    sessions: sessions.length,
    accounts: accounts.length,
    feedback: feedbackRows.length,
    activityEvents: activity.length,
    analyticsErasureQueued: erasure.length > 0,
  };
};
