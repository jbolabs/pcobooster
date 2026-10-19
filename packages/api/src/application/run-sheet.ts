import { ensureRequestIsOpen } from "@pcobooster/api/application/context";
import type { RequestContext } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import type { PlanningCenterAccess } from "@pcobooster/api/application/planning-center-access";
import { withPlanningCenterFaults } from "@pcobooster/api/application/planning-center-access";
import { PlanningCenterCatalog } from "@pcobooster/api/application/planning-center/catalog";
import { OrganizationTimeZone } from "@pcobooster/api/application/planning-center/organization-time-zone";
import { PlanningCenterPeople } from "@pcobooster/api/application/planning-center/people";
import { PlanningCenterPlanItems } from "@pcobooster/api/application/planning-center/plan-items";
import { PlanningCenterPlans } from "@pcobooster/api/application/planning-center/plans";
import { PlanningCenterSongs } from "@pcobooster/api/application/planning-center/songs";
import { songCatalogCacheScope } from "@pcobooster/api/application/song-catalog-revision";
import {
  commitCreatePlanItem,
  prepareCreatePlanItem,
} from "@pcobooster/api/modules/planning-center/create-plan-item";
import type { PreparedCreatePlanItem } from "@pcobooster/api/modules/planning-center/create-plan-item";
import { deletePlanItem } from "@pcobooster/api/modules/planning-center/delete-plan-item";
import { getPlanItems } from "@pcobooster/api/modules/planning-center/get-plan-items";
import { getSongOptions } from "@pcobooster/api/modules/planning-center/get-song-options";
import type { LoadSongOptions } from "@pcobooster/api/modules/planning-center/plan-item-payload";
import { updatePlanPersonTimes } from "@pcobooster/api/modules/planning-center/plan-person-times";
import {
  createPlanTime,
  deletePlanTime,
  getPlanTimes,
  updatePlanTime,
} from "@pcobooster/api/modules/planning-center/plan-times";
import type { PlanTimeDependencies } from "@pcobooster/api/modules/planning-center/plan-times";
import { reorderPlanItems } from "@pcobooster/api/modules/planning-center/reorder-plan-items";
import { searchSongs } from "@pcobooster/api/modules/planning-center/search-songs";
import { getSongHistory } from "@pcobooster/api/modules/planning-center/song-history";
import type { SongHistoryEntry } from "@pcobooster/api/modules/planning-center/song-history";
import { suggestSongs } from "@pcobooster/api/modules/planning-center/song-suggestions";
import type { SongSuggestions } from "@pcobooster/api/modules/planning-center/song-suggestions";
import {
  commitUpdatePlanItem,
  prepareUpdatePlanItem,
} from "@pcobooster/api/modules/planning-center/update-plan-item";
import type { PreparedUpdatePlanItem } from "@pcobooster/api/modules/planning-center/update-plan-item";
import { Server } from "@pcobooster/api/server";
import type {
  PlanItemsCreateInput,
  PlanItemsDeleteInput,
  PlanItemsListInput,
  PlanItemsReorderInput,
  PlanItemsUpdateInput,
} from "@pcobooster/contracts/http/plan-items";
import type { PlanPeopleUpdateTimesInput } from "@pcobooster/contracts/http/plan-people";
import type {
  PlanTimesCreateInput,
  PlanTimesDeleteInput,
  PlanTimesListInput,
  PlanTimesUpdateInput,
} from "@pcobooster/contracts/http/plan-times";
import type {
  SongsHistoryInput,
  SongsOptionsInput,
  SongsSearchInput,
} from "@pcobooster/contracts/http/songs";
import type {
  PlanItem,
  PlanTime,
  SongCatalogEntry,
  SongOptionSet,
} from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const planTimeDependencies: Effect.Effect<
  PlanTimeDependencies,
  never,
  PlanningCenterPlans | PlanningCenterPeople | PlanningCenterCatalog
> = Effect.gen(function* readPlanTimeDependencies() {
  return {
    plansService: yield* PlanningCenterPlans,
    peopleService: yield* PlanningCenterPeople,
    catalogService: yield* PlanningCenterCatalog,
  };
});

const requestSongOptions: Effect.Effect<
  LoadSongOptions,
  never,
  PlanningCenterSongs
> = PlanningCenterSongs.pipe(
  Effect.map(
    (songsService): LoadSongOptions =>
      (songId, serviceTypeId) =>
        getSongOptions(songId, serviceTypeId, songsService)
  )
);

export const listPlanItems = (
  input: PlanItemsListInput
): Effect.Effect<PlanItem[], ApplicationFault, PlanningCenterPlanItems> =>
  Effect.gen(function* listItems() {
    const planItemsService = yield* PlanningCenterPlanItems;
    return yield* getPlanItems(
      input.serviceTypeId,
      input.planId,
      planItemsService
    );
  }).pipe(withPlanningCenterFaults);

export const prepareRunSheetItemCreate = (
  input: PlanItemsCreateInput
): Effect.Effect<
  PreparedCreatePlanItem,
  ApplicationFault,
  PlanningCenterAccess | PlanningCenterSongs | Server
> =>
  Effect.gen(function* prepareItemCreate() {
    return yield* prepareCreatePlanItem(
      {
        ...input,
        songId: input.songId ?? undefined,
        arrangementId: input.arrangementId ?? undefined,
        keyId: input.keyId ?? undefined,
        selectedLayoutId: input.selectedLayoutId ?? undefined,
      },
      yield* requestSongOptions
    );
  }).pipe(withPlanningCenterFaults);

/**
 * Commits begin at the provider-write boundary: the transport runs them
 * without request-driven interruption, so an open request is checked first.
 */
export const commitRunSheetItemCreate = (
  prepared: PreparedCreatePlanItem
): Effect.Effect<
  PlanItem,
  ApplicationFault,
  PlanningCenterPlanItems | RequestContext
> =>
  Effect.gen(function* commitItemCreate() {
    const planItemsService = yield* PlanningCenterPlanItems;
    yield* ensureRequestIsOpen;
    return yield* commitCreatePlanItem(prepared, planItemsService);
  }).pipe(withPlanningCenterFaults);

export const prepareRunSheetItemUpdate = (
  input: PlanItemsUpdateInput
): Effect.Effect<
  PreparedUpdatePlanItem,
  ApplicationFault,
  PlanningCenterAccess | PlanningCenterSongs | Server
> =>
  Effect.gen(function* prepareItemUpdate() {
    return yield* prepareUpdatePlanItem(
      {
        ...input,
        songId: input.songId ?? undefined,
        arrangementId: input.arrangementId ?? undefined,
        keyId: input.keyId ?? undefined,
        selectedLayoutId: input.selectedLayoutId ?? undefined,
      },
      yield* requestSongOptions
    );
  }).pipe(withPlanningCenterFaults);

export const commitRunSheetItemUpdate = (
  prepared: PreparedUpdatePlanItem
): Effect.Effect<
  PlanItem,
  ApplicationFault,
  PlanningCenterPlanItems | RequestContext
> =>
  Effect.gen(function* commitItemUpdate() {
    const planItemsService = yield* PlanningCenterPlanItems;
    yield* ensureRequestIsOpen;
    return yield* commitUpdatePlanItem(prepared, planItemsService);
  }).pipe(withPlanningCenterFaults);

export const deleteRunSheetItem = (
  input: PlanItemsDeleteInput
): Effect.Effect<
  { readonly success: true },
  ApplicationFault,
  PlanningCenterPlanItems | RequestContext
> =>
  Effect.gen(function* deleteItem() {
    const planItemsService = yield* PlanningCenterPlanItems;
    yield* ensureRequestIsOpen;
    yield* deletePlanItem(input.serviceTypeId, input.planId, input.itemId, {
      planItemsService,
    });
    return { success: true as const };
  }).pipe(withPlanningCenterFaults);

export const reorderRunSheetItems = (
  input: PlanItemsReorderInput
): Effect.Effect<
  { readonly success: true },
  ApplicationFault,
  PlanningCenterPlanItems | RequestContext
> =>
  Effect.gen(function* reorderItems() {
    const planItemsService = yield* PlanningCenterPlanItems;
    yield* ensureRequestIsOpen;
    yield* reorderPlanItems(input.serviceTypeId, input.planId, input.sequence, {
      planItemsService,
    });
    return { success: true as const };
  }).pipe(withPlanningCenterFaults);

export const listPlanTimes = (
  input: PlanTimesListInput
): Effect.Effect<
  PlanTime[],
  ApplicationFault,
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | PlanningCenterPlans
> =>
  Effect.gen(function* listTimes() {
    return yield* getPlanTimes(
      input.serviceTypeId,
      input.planId,
      yield* planTimeDependencies
    );
  }).pipe(withPlanningCenterFaults);

export const createRunSheetTime = (
  input: PlanTimesCreateInput
): Effect.Effect<
  PlanTime,
  ApplicationFault,
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | PlanningCenterPlans
  | RequestContext
> =>
  Effect.gen(function* createTime() {
    yield* ensureRequestIsOpen;
    return yield* createPlanTime(input, yield* planTimeDependencies);
  }).pipe(withPlanningCenterFaults);

export const updateRunSheetTime = (
  input: PlanTimesUpdateInput
): Effect.Effect<
  PlanTime,
  ApplicationFault,
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | PlanningCenterPlans
  | RequestContext
> =>
  Effect.gen(function* updateTime() {
    yield* ensureRequestIsOpen;
    return yield* updatePlanTime(input, yield* planTimeDependencies);
  }).pipe(withPlanningCenterFaults);

export const deleteRunSheetTime = (
  input: PlanTimesDeleteInput
): Effect.Effect<
  void,
  ApplicationFault,
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | PlanningCenterPlans
  | RequestContext
> =>
  Effect.gen(function* deleteTime() {
    yield* ensureRequestIsOpen;
    yield* deletePlanTime(input, yield* planTimeDependencies);
  }).pipe(withPlanningCenterFaults);

export const updateRunSheetPersonTimes = (
  input: PlanPeopleUpdateTimesInput
): Effect.Effect<
  { readonly ok: true },
  ApplicationFault,
  PlanningCenterPeople | RequestContext
> =>
  Effect.gen(function* updatePersonTimes() {
    const peopleService = yield* PlanningCenterPeople;
    yield* ensureRequestIsOpen;
    yield* updatePlanPersonTimes(input, {
      peopleService,
    });
    return { ok: true as const };
  }).pipe(withPlanningCenterFaults);

export const searchRunSheetSongs = (
  input: SongsSearchInput
): Effect.Effect<
  SongCatalogEntry[],
  ApplicationFault,
  PlanningCenterAccess | PlanningCenterSongs | Server
> =>
  Effect.gen(function* searchRunSheetCatalog() {
    const cacheScope = yield* songCatalogCacheScope;
    const songsService = yield* PlanningCenterSongs;
    const { moduleReadCaches } = yield* Server;
    return yield* searchSongs(
      cacheScope,
      input.query,
      songsService,
      moduleReadCaches.songSearchResults
    );
  }).pipe(withPlanningCenterFaults);

export const suggestRunSheetSongs = (): Effect.Effect<
  SongSuggestions,
  ApplicationFault,
  PlanningCenterAccess | PlanningCenterSongs | Server
> =>
  Effect.gen(function* suggestFromCatalog() {
    const cacheScope = yield* songCatalogCacheScope;
    const songsService = yield* PlanningCenterSongs;
    return yield* suggestSongs(cacheScope, songsService, new Date());
  }).pipe(withPlanningCenterFaults);

export const getRunSheetSongHistory = (
  input: SongsHistoryInput
): Effect.Effect<
  SongHistoryEntry[],
  ApplicationFault,
  OrganizationTimeZone | PlanningCenterSongs
> =>
  Effect.gen(function* readSongHistory() {
    const songsService = yield* PlanningCenterSongs;
    const organizationTimeZone = yield* OrganizationTimeZone;
    return yield* getSongHistory(input.songId, new Date(), {
      songs: songsService,
      resolveTimeZone: organizationTimeZone,
    });
  }).pipe(withPlanningCenterFaults);

export const getRunSheetSongOptions = (
  input: SongsOptionsInput
): Effect.Effect<SongOptionSet, ApplicationFault, PlanningCenterSongs> =>
  Effect.gen(function* readSongOptions() {
    const songsService = yield* PlanningCenterSongs;
    return yield* getSongOptions(
      input.songId,
      input.serviceTypeId,
      songsService
    );
  }).pipe(withPlanningCenterFaults);
