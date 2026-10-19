import type { Db } from "@pcobooster/api/db/client";
import { songCatalogRevision } from "@pcobooster/api/db/schema";
import { eq, sql } from "drizzle-orm";

/** D1 reads the primary: a completed write must change every isolate's catalog cache key. */
export const readSongCatalogCacheScope = async (
  database: Db,
  scope: string
): Promise<string> => {
  const [row] = await database
    .select({ revision: songCatalogRevision.revision })
    .from(songCatalogRevision)
    .where(eq(songCatalogRevision.scope, scope));
  return `${scope}:catalog-revision:${row?.revision ?? 0}`;
};

export const advanceSongCatalogRevision = async (
  database: Db,
  scope: string
): Promise<void> => {
  await database
    .insert(songCatalogRevision)
    .values({ scope, revision: 1 })
    .onConflictDoUpdate({
      target: songCatalogRevision.scope,
      set: { revision: sql`${songCatalogRevision.revision} + 1` },
    });
};
