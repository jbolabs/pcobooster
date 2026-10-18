import { moduleLog } from "@pcobooster/api/logging";
import { buildPlanningCenterUrl } from "@pcobooster/api/planning-center/core-client";
import type {
  PlanningCenterCoreClient,
  PlanningCenterError,
  PlanningCenterPage,
} from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPaginationError } from "@pcobooster/api/planning-center/pagination-error";
import { recoverPlanningCenterFailure } from "@pcobooster/api/planning-center/recover-failure";
import { cachedRead } from "@pcobooster/api/planning-center/services/cached-read";
import {
  PlanningCenterReadCache,
  stableParams,
} from "@pcobooster/api/planning-center/services/read-cache";
import { planFieldsParams } from "@pcobooster/api/planning-center/sparse-fields";
import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const log = moduleLog("planning-center/plans");
const PLANS_RANGE_CACHE_TTL_MS = 5 * 60 * 1000;
/** Pages of 100 plans `getPlansWithIncludedInDateRange` reads, at most. */
export const PLAN_RANGE_MAX_PAGES = 3;

interface ResourceCollection {
  data: PCResource[];
  included: PCResource[];
}

/** A range's plans; `complete` is false when the range went on past the pages read. */
export interface PlanRange extends ResourceCollection {
  complete: boolean;
}

export interface PlanningCenterPlansServiceCaches {
  /** Pages of a service type's plans from a day on, in date order. */
  readonly rangePages: PlanningCenterReadCache<PlanningCenterPage>;
  readonly planTimes: PlanningCenterReadCache<PCResource[]>;
}

export const createPlanningCenterPlansServiceCaches =
  (): PlanningCenterPlansServiceCaches => ({
    rangePages: new PlanningCenterReadCache<PlanningCenterPage>(),
    planTimes: new PlanningCenterReadCache<PCResource[]>(),
  });

const buildPlanTimeAssignmentRelationships = (
  assignedTeamIds?: string[],
  assignedPositionIds?: string[]
) => {
  const relationships = {
    ...(assignedTeamIds === undefined
      ? undefined
      : {
          assigned_teams: {
            data: assignedTeamIds.map((id) => ({ type: "Team", id })),
          },
        }),
    ...(assignedPositionIds === undefined
      ? undefined
      : {
          assigned_positions: {
            data: assignedPositionIds.map((id) => ({
              type: "TeamPosition",
              id,
            })),
          },
        }),
  };
  return Object.keys(relationships).length > 0 ? relationships : null;
};

/** The plan's sort date as an organization calendar day, or null without one. */
const planDayKey = (
  plan: PCResource,
  organizationTimeZone: string
): string | null => {
  const sortDateStr = plan.attributes.sort_date;
  if (!isNonEmptyString(sortDateStr)) {
    return null;
  }
  const sortDate = new Date(sortDateStr);
  return Number.isNaN(sortDate.getTime())
    ? null
    : formatCalendarDayInTimeZone(sortDate, organizationTimeZone);
};

export const isInOrganizationDayRange = (
  plan: PCResource,
  afterDayKey: string,
  beforeDayKey: string,
  organizationTimeZone: string
): boolean => {
  const day = planDayKey(plan, organizationTimeZone);
  return day !== null && day >= afterDayKey && day <= beforeDayKey;
};

/**
 * Where a range read goes after `page`: `null` once the range is read, either because the
 * collection ended or because the page's last dated plan falls after `beforeDayKey` (pages come
 * in date order, so later pages hold only later plans).
 */
export const nextRangeOffset = (
  page: PlanningCenterPage,
  beforeDayKey: string,
  organizationTimeZone: string
): number | null => {
  const lastDay = page.data
    .map((plan) => planDayKey(plan, organizationTimeZone))
    .findLast((day) => day !== null);
  return lastDay !== undefined && lastDay !== null && lastDay > beforeDayKey
    ? null
    : page.nextOffset;
};

const planAttachmentsPath = (serviceTypeId: string, planId: string) =>
  `/services/v2/service_types/${serviceTypeId}/plans/${planId}/all_attachments`;

export class PlanningCenterPlansService {
  private readonly core: PlanningCenterCoreClient;
  private readonly resolveTimeZone: Effect.Effect<string, PlanningCenterError>;
  private readonly caches: PlanningCenterPlansServiceCaches;

  constructor(
    core: PlanningCenterCoreClient,
    resolveTimeZone: Effect.Effect<string, PlanningCenterError>,
    caches: PlanningCenterPlansServiceCaches = createPlanningCenterPlansServiceCaches()
  ) {
    this.core = core;
    this.resolveTimeZone = resolveTimeZone;
    this.caches = caches;
  }

  getPlans(
    serviceTypeId: string,
    params: Record<string, string> = {}
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return Effect.map(
      this.core.fetchFirstPages(
        `/services/v2/service_types/${serviceTypeId}/plans`,
        { ...params, order: "-sort_date" },
        3
      ),
      ({ data }) => data
    );
  }

  /**
   * One page of plans in the given order, for finding the plans next to one plan. Planning
   * Center's response time grows with the page size (a page of 100 past plans takes seconds),
   * so callers ask only for what they need.
   */
  getPlansPage(
    serviceTypeId: string,
    params: Record<string, string>,
    order: "sort_date" | "-sort_date",
    perPage: number
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return Effect.map(
      this.core.fetchCollection(
        buildPlanningCenterUrl(
          `/services/v2/service_types/${serviceTypeId}/plans`,
          { ...params, ...planFieldsParams, order, per_page: String(perPage) }
        )
      ),
      (response) => response.data
    );
  }

  /**
   * Fetch plans from `afterDayKey` onward (YYYY-MM-DD in org TZ) via filter=after.
   * Trims to plans whose sort_date falls on [`afterDayKey`, `beforeDayKey`] in the org timezone.
   */
  getPlansInDateRange(
    serviceTypeId: string,
    afterDayKey: string,
    beforeDayKey: string,
    organizationTimeZone?: string
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return Effect.flatMap(
      this.getPlansWithIncludedInDateRange(
        serviceTypeId,
        afterDayKey,
        beforeDayKey,
        "",
        organizationTimeZone
      ),
      (range) =>
        range.complete
          ? Effect.succeed(range.data)
          : Effect.fail(
              new PlanningCenterPaginationError({
                reason: "page-limit",
                path: `/services/v2/service_types/${serviceTypeId}/plans`,
                pages: PLAN_RANGE_MAX_PAGES,
              })
            )
    );
  }

  /**
   * One page of a service type's plans from `afterDayKey` (YYYY-MM-DD in the organization's
   * zone) on, in date order, via `filter=after`. Cached per page and shared by every range
   * that starts that day, so reads that go page by page across calls resume from cache.
   */
  getPlanRangePage(
    serviceTypeId: string,
    afterDayKey: string,
    include: string,
    offset: number
  ): Effect.Effect<PlanningCenterPage, PlanningCenterError> {
    const params = {
      order: "sort_date",
      filter: "after",
      after: afterDayKey,
      ...(include ? { include } : undefined),
      ...planFieldsParams,
    };
    return cachedRead(
      this.caches.rangePages,
      [
        this.core.getCacheScope(),
        "plans-range",
        encodeURIComponent(serviceTypeId),
        stableParams(params),
        String(offset),
      ].join(":"),
      PLANS_RANGE_CACHE_TTL_MS,
      () =>
        this.core.fetchPage(
          `/services/v2/service_types/${serviceTypeId}/plans`,
          params,
          offset
        )
    ).pipe(Effect.map((page) => structuredClone(page)));
  }

  /**
   * The plans whose sort date falls on [`afterDayKey`, `beforeDayKey`] in the organization's
   * zone, with what `include` sideloads for them. Pages are read until one passes
   * `beforeDayKey`, at most `PLAN_RANGE_MAX_PAGES`; `complete` is false when the range went on
   * past them, so each caller decides whether the plans read are enough.
   */
  getPlansWithIncludedInDateRange(
    serviceTypeId: string,
    afterDayKey: string,
    beforeDayKey: string,
    include = "",
    organizationTimeZone?: string
  ): Effect.Effect<PlanRange, PlanningCenterError> {
    const resolveTimeZone =
      organizationTimeZone === undefined
        ? this.resolveTimeZone
        : Effect.succeed(organizationTimeZone);
    const readPage = (offset: number) =>
      this.getPlanRangePage(serviceTypeId, afterDayKey, include, offset);
    return Effect.gen(function* readPlansInDateRange() {
      const orgTz = yield* resolveTimeZone;
      const data: PCResource[] = [];
      const included: PCResource[] = [];
      const seenIncluded = new Set<string>();
      let offset: number | null = 0;
      for (
        let pages = 0;
        offset !== null && pages < PLAN_RANGE_MAX_PAGES;
        pages += 1
      ) {
        const page: PlanningCenterPage = yield* readPage(offset);
        data.push(...page.data);
        for (const resource of page.included) {
          const key = `${resource.type}:${resource.id}`;
          if (!seenIncluded.has(key)) {
            seenIncluded.add(key);
            included.push(resource);
          }
        }
        offset = nextRangeOffset(page, beforeDayKey, orgTz);
      }
      const plans = data.filter((plan) =>
        isInOrganizationDayRange(plan, afterDayKey, beforeDayKey, orgTz)
      );
      const planIds = new Set(plans.map((plan) => plan.id));
      if (offset !== null) {
        yield* log.info("Plan range read stopped at its page limit", {
          serviceTypeId,
          after: afterDayKey,
          before: beforeDayKey,
          pages: PLAN_RANGE_MAX_PAGES,
        });
      }
      return {
        data: plans,
        included: included.filter((resource) => {
          const planRel = resource.relationships?.plan?.data;
          const planId = Array.isArray(planRel) ? planRel[0]?.id : planRel?.id;
          return !isNonEmptyString(planId) || planIds.has(planId);
        }),
        complete: offset === null,
      };
    });
  }

  getPlan(planId: string): Effect.Effect<PCResource, PlanningCenterError> {
    return Effect.map(
      this.core.fetch(`/services/v2/plans/${planId}`),
      (response) => response.data
    );
  }

  getPlanTimes(
    serviceTypeId: string,
    planId: string
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return cachedRead(
      this.caches.planTimes,
      this.buildCacheKey("plan-times", serviceTypeId, planId),
      PLANS_RANGE_CACHE_TTL_MS,
      () =>
        this.core.fetchAll(
          `/services/v2/service_types/${serviceTypeId}/plans/${planId}/plan_times`,
          {
            order: "starts_at",
            per_page: "100",
            include: "split_team_rehearsal_assignments",
          },
          10
        )
    ).pipe(Effect.map((planTimes) => structuredClone(planTimes)));
  }

  updatePlanTime(
    serviceTypeId: string,
    planId: string,
    planTimeId: string,
    attributes: JsonObject,
    assignedTeamIds?: string[],
    assignedPositionIds?: string[]
  ): Effect.Effect<PCResource, PlanningCenterError> {
    const relationships = buildPlanTimeAssignmentRelationships(
      assignedTeamIds,
      assignedPositionIds
    );
    return this.core
      .fetch(
        `/services/v2/service_types/${serviceTypeId}/plan_times/${planTimeId}`,
        {
          method: "PATCH",
          body: {
            data: {
              type: "PlanTime",
              id: planTimeId,
              attributes,
              ...(relationships ? { relationships } : undefined),
            },
          },
        }
      )
      .pipe(
        Effect.map((response) => {
          this.invalidatePlanTimesCache(serviceTypeId, planId);
          return response.data;
        })
      );
  }

  createPlanTime(
    serviceTypeId: string,
    planId: string,
    attributes: JsonObject,
    assignedTeamIds?: string[],
    assignedPositionIds?: string[]
  ): Effect.Effect<PCResource, PlanningCenterError> {
    const relationships = buildPlanTimeAssignmentRelationships(
      assignedTeamIds,
      assignedPositionIds
    );
    return this.core
      .fetch(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}/plan_times`,
        {
          method: "POST",
          body: {
            data: {
              type: "PlanTime",
              attributes,
              ...(relationships ? { relationships } : undefined),
            },
          },
        }
      )
      .pipe(
        Effect.map((response) => {
          this.invalidatePlanTimesCache(serviceTypeId, planId);
          return response.data;
        })
      );
  }

  /** A plan time Planning Center no longer has is already deleted. */
  deletePlanTime(
    serviceTypeId: string,
    planId: string,
    planTimeId: string
  ): Effect.Effect<void, PlanningCenterError> {
    return this.core
      .request(
        `/services/v2/service_types/${serviceTypeId}/plan_times/${planTimeId}`,
        { method: "DELETE" }
      )
      .pipe(
        recoverPlanningCenterFailure({
          kinds: ["not-found"],
          reason: "Plan time not found; it is already deleted",
          details: { planId, planTimeId },
          fallback: () => null,
        }),
        Effect.asVoid,
        Effect.tap(() =>
          Effect.sync(() => {
            this.invalidatePlanTimesCache(serviceTypeId, planId);
          })
        )
      );
  }

  getPlanForServiceTypeWithSeries(
    serviceTypeId: string,
    planId: string
  ): Effect.Effect<
    { data: PCResource; included: PCResource[] },
    PlanningCenterError
  > {
    return Effect.map(
      this.core.fetch(
        `/services/v2/service_types/${serviceTypeId}/plans/${planId}?include=series`
      ),
      (response) => ({
        data: response.data,
        included: response.included ?? [],
      })
    );
  }

  /**
   * One page of every file the plan reaches: its own, its items', and its songs'
   * arrangements' and keys'. Plan-scoped paths let Planning Center apply the caller's access.
   */
  getPlanAttachmentsPage(
    serviceTypeId: string,
    planId: string,
    offset: number
  ): Effect.Effect<PlanningCenterPage, PlanningCenterError> {
    return this.core.fetchPage(
      planAttachmentsPath(serviceTypeId, planId),
      {},
      offset
    );
  }

  getPlanAttachment(
    serviceTypeId: string,
    planId: string,
    attachmentId: string
  ): Effect.Effect<PCResource, PlanningCenterError> {
    return Effect.map(
      this.core.fetch(
        `${planAttachmentsPath(serviceTypeId, planId)}/${attachmentId}`
      ),
      (response) => response.data
    );
  }

  /**
   * A short-lived link to the file, or to Planning Center's preview of it. Opening records a
   * view and changes nothing, so the read-only demo client allows it.
   */
  openPlanAttachment(
    serviceTypeId: string,
    planId: string,
    attachmentId: string,
    preview: boolean
  ): Effect.Effect<string, PlanningCenterError> {
    return this.core
      .fetch(
        `${planAttachmentsPath(serviceTypeId, planId)}/${attachmentId}/${preview ? "preview" : "open"}`,
        { method: "POST", body: {}, readAction: true }
      )
      .pipe(
        Effect.map((response) => {
          const url = response.data.attributes.attachment_url;
          return isNonEmptyString(url) ? url : "";
        })
      );
  }

  invalidatePlanTimesCache(serviceTypeId: string, planId: string) {
    const scope = this.core.getCacheScope();
    const planTimesKey = this.buildCacheKey(
      "plan-times",
      serviceTypeId,
      planId
    );
    const plansRangePrefix = [
      scope,
      "plans-range",
      encodeURIComponent(serviceTypeId),
      "",
    ].join(":");

    this.caches.planTimes.deleteWhere((key) => key === planTimesKey);
    this.caches.rangePages.deleteWhere((key) =>
      key.startsWith(plansRangePrefix)
    );
  }

  private buildCacheKey(namespace: string, ...parts: string[]): string {
    return [
      this.core.getCacheScope(),
      namespace,
      ...parts.map((part) => encodeURIComponent(part)),
    ].join(":");
  }
}
