import type { PlanningCenterIdentity } from "@pcobooster/api/auth/planning-center-identity";
import type { Db } from "@pcobooster/api/db/client";
import { planningCenterAccountIdentities } from "@pcobooster/api/db/schema";

export type StoredPlanningCenterAccountIdentity = PlanningCenterIdentity & {
  accountId: string;
  providerAccountId: string;
  fetchedAt: string;
};

export const upsertPlanningCenterAccountIdentity = async (
  input: {
    accountId: string;
    providerAccountId: string;
    identity: PlanningCenterIdentity;
    fetchedAt?: Date;
  },
  database: Db
) => {
  const now = new Date();
  const fetchedAt = input.fetchedAt ?? now;

  await database
    .insert(planningCenterAccountIdentities)
    .values({
      accountId: input.accountId,
      providerAccountId: input.providerAccountId,
      planningCenterUserId: input.identity.sub,
      name: input.identity.name,
      email: input.identity.email,
      organizationId: input.identity.organizationId,
      organizationName: input.identity.organizationName,
      fetchedAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: planningCenterAccountIdentities.accountId,
      set: {
        providerAccountId: input.providerAccountId,
        planningCenterUserId: input.identity.sub,
        name: input.identity.name,
        email: input.identity.email,
        organizationId: input.identity.organizationId,
        organizationName: input.identity.organizationName,
        fetchedAt,
        updatedAt: now,
      },
    });
};

export const getPlanningCenterAccountIdentity = async (
  accountId: string,
  database: Db
): Promise<StoredPlanningCenterAccountIdentity | null> => {
  const row = await database.query.planningCenterAccountIdentities.findFirst({
    where: { accountId },
  });
  if (!row) {
    return null;
  }

  return {
    accountId: row.accountId,
    providerAccountId: row.providerAccountId,
    sub: row.planningCenterUserId,
    name: row.name,
    email: row.email,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    fetchedAt: row.fetchedAt.toISOString(),
  };
};
