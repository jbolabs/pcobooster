import {
  PlanningCenterCoreClient,
  createBasicPlanningCenterClient,
} from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterPersonalAccessToken } from "@pcobooster/api/planning-center/core-client";
import {
  createOrganizationTimeZoneCache,
  resolveOrganizationTimeZone,
} from "@pcobooster/api/planning-center/resolve-organization-timezone";
import type { OrganizationTimeZoneCache } from "@pcobooster/api/planning-center/resolve-organization-timezone";
import { PlanningCenterAccessService } from "@pcobooster/api/planning-center/services/access-service";
import {
  createPlanningCenterCatalogServiceCaches,
  PlanningCenterCatalogService,
} from "@pcobooster/api/planning-center/services/catalog-service";
import type { PlanningCenterCatalogServiceCaches } from "@pcobooster/api/planning-center/services/catalog-service";
import {
  createPlanningCenterPeopleServiceCaches,
  PlanningCenterPeopleService,
} from "@pcobooster/api/planning-center/services/people-service";
import type { PlanningCenterPeopleServiceCaches } from "@pcobooster/api/planning-center/services/people-service";
import { PlanningCenterPlanItemsService } from "@pcobooster/api/planning-center/services/plan-items-service";
import {
  createPlanningCenterPlansServiceCaches,
  PlanningCenterPlansService,
} from "@pcobooster/api/planning-center/services/plans-service";
import type { PlanningCenterPlansServiceCaches } from "@pcobooster/api/planning-center/services/plans-service";
import type { PlanningCenterReadCache } from "@pcobooster/api/planning-center/services/read-cache";
import {
  allTeamPeopleCodec,
  resourceListCodec,
} from "@pcobooster/api/planning-center/services/shared-read-codecs";
import {
  createSharedReadKeys,
  createSharedReadTier,
} from "@pcobooster/api/planning-center/services/shared-read-store";
import type {
  SharedReadCodec,
  SharedReadErrorReporter,
  SharedReadSession,
  SharedReadStore,
  SharedReadTier,
} from "@pcobooster/api/planning-center/services/shared-read-store";
import {
  createPlanningCenterSongsServiceCaches,
  PlanningCenterSongsService,
} from "@pcobooster/api/planning-center/services/songs-service";
import type { PlanningCenterSongsServiceCaches } from "@pcobooster/api/planning-center/services/songs-service";
import { Effect } from "effect";
import type { HttpClient } from "effect/http/HttpClient";

/**
 * Planning Center read caches for one Worker isolate: in-memory caches shared by every
 * request it serves, and optionally a shared tier that every isolate reads through.
 */
export interface PlanningCenterReadCaches {
  readonly catalog: PlanningCenterCatalogServiceCaches;
  readonly people: PlanningCenterPeopleServiceCaches;
  readonly plans: PlanningCenterPlansServiceCaches;
  readonly songs: PlanningCenterSongsServiceCaches;
  readonly organizationTimeZones: OrganizationTimeZoneCache;
  readonly shared: SharedReadTier | null;
}

/** Pass `null` for memory-only caches, as in tests. */
export const createPlanningCenterReadCaches = (
  shared: {
    readonly store: SharedReadStore;
    readonly reportError: SharedReadErrorReporter;
  } | null
): PlanningCenterReadCaches => ({
  catalog: createPlanningCenterCatalogServiceCaches(),
  people: createPlanningCenterPeopleServiceCaches(),
  plans: createPlanningCenterPlansServiceCaches(),
  songs: createPlanningCenterSongsServiceCaches(),
  organizationTimeZones: createOrganizationTimeZoneCache(),
  shared:
    shared === null
      ? null
      : createSharedReadTier(shared.store, shared.reportError),
});

/**
 * One request's view of the isolate's caches: loaded values are shared with every request, but
 * a request only joins loads it started (see `PlanningCenterReadCache`).
 */
export const planningCenterReadCachesForRequest = (
  caches: PlanningCenterReadCaches
): PlanningCenterReadCaches => ({
  catalog: {
    serviceTypes: caches.catalog.serviceTypes.forRequest(),
    reads: caches.catalog.reads.forRequest(),
  },
  people: {
    people: caches.people.people.forRequest(),
    resourceLists: caches.people.resourceLists.forRequest(),
    collections: caches.people.collections.forRequest(),
    collectionPrefixes: caches.people.collectionPrefixes.forRequest(),
    pages: caches.people.pages.forRequest(),
    allTeamPeople: caches.people.allTeamPeople.forRequest(),
    planWindowRosters: caches.people.planWindowRosters.forRequest(),
  },
  plans: {
    rangePages: caches.plans.rangePages.forRequest(),
    planTimes: caches.plans.planTimes.forRequest(),
  },
  songs: {
    catalogs: caches.songs.catalogs.forRequest(),
    songs: caches.songs.songs.forRequest(),
    arrangements: caches.songs.arrangements.forRequest(),
    schedules: caches.songs.schedules.forRequest(),
  },
  // Holds resolved zones only, never a load in flight.
  organizationTimeZones: caches.organizationTimeZones,
  shared: caches.shared,
});

/**
 * Backs the caches worth sharing with this request's shared-tier session. A cache is shared
 * only if no mutation in this app invalidates it (the shared tier cannot be invalidated in
 * other isolates) and a KV hit saves more Planning Center requests than the KV calls cost,
 * since both consume the configured Paid Worker subrequest budget. See `docs/api-architecture.md`.
 */
const bindReadCaches = (
  caches: PlanningCenterReadCaches,
  session: SharedReadSession | null,
  scope: string
): Omit<PlanningCenterReadCaches, "shared"> => {
  if (session === null) {
    return caches;
  }
  const share = <Value>(
    cache: PlanningCenterReadCache<Value>,
    name: string,
    codec: SharedReadCodec<Value>
  ): PlanningCenterReadCache<Value> =>
    cache.withSharedTier({
      session,
      keys: createSharedReadKeys(scope, name),
      codec,
    });
  return {
    ...caches,
    people: {
      ...caches.people,
      // The teams list plus one request per team.
      allTeamPeople: share(
        caches.people.allTeamPeople,
        "people.all-team-people",
        allTeamPeopleCodec
      ),
    },
    songs: {
      ...caches.songs,
      // About one request per hundred songs.
      catalogs: share(
        caches.songs.catalogs,
        "songs.catalogs",
        resourceListCodec
      ),
    },
  };
};

const createServicesForClient = (
  core: PlanningCenterCoreClient,
  fallbackTimeZone: string,
  readCaches: PlanningCenterReadCaches
) => {
  const session = readCaches.shared?.session() ?? null;
  const caches = bindReadCaches(readCaches, session, core.getCacheScope());
  const catalog = new PlanningCenterCatalogService(core, caches.catalog);
  const organizationTimeZone = resolveOrganizationTimeZone({
    cacheScope: core.getCacheScope(),
    cache: caches.organizationTimeZones,
    catalogService: catalog,
    fallbackTimeZone,
  });

  return {
    core,
    /** The signed-in person's own permissions in each product. */
    access: new PlanningCenterAccessService(core),
    catalog,
    /** The organization's IANA zone, or the configured fallback; cached per isolate. */
    organizationTimeZone,
    people: new PlanningCenterPeopleService(core, caches.people),
    planItems: new PlanningCenterPlanItemsService(core),
    plans: new PlanningCenterPlansService(
      core,
      organizationTimeZone,
      caches.plans
    ),
    songs: new PlanningCenterSongsService(core, caches.songs),
    /**
     * Waits for this request's shared-cache writes. workerd cancels a request's unfinished
     * I/O once it responds, so the request runs this first. Never fails.
     */
    settleReadCaches: Effect.promise(async () => {
      await session?.settle();
    }),
  };
};

export const createPlanningCenterServices = (
  accessToken: string,
  fallbackTimeZone: string,
  httpClient: HttpClient,
  readCaches: PlanningCenterReadCaches,
  readOnly = false
) =>
  createServicesForClient(
    new PlanningCenterCoreClient(
      { kind: "bearer", accessToken },
      { httpClient, readOnly }
    ),
    fallbackTimeZone,
    readCaches
  );

export const createBasicPlanningCenterServices = (
  token: PlanningCenterPersonalAccessToken,
  fallbackTimeZone: string,
  httpClient: HttpClient,
  readCaches: PlanningCenterReadCaches
) =>
  createServicesForClient(
    createBasicPlanningCenterClient(token, httpClient),
    fallbackTimeZone,
    readCaches
  );

/** Demo services can read the demo organization but never write to it. */
export const createReadOnlyPlanningCenterServices = (
  token: PlanningCenterPersonalAccessToken,
  fallbackTimeZone: string,
  httpClient: HttpClient,
  readCaches: PlanningCenterReadCaches
) =>
  createServicesForClient(
    new PlanningCenterCoreClient(
      { kind: "basic", ...token },
      { httpClient, readOnly: true }
    ),
    fallbackTimeZone,
    readCaches
  );
