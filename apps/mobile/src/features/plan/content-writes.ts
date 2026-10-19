import type {
  planItemsCreateInputSchema,
  planItemsUpdateInputSchema,
} from "@pcobooster/contracts/http/plan-items";
import type {
  planTimesCreateInputSchema,
  planTimesUpdateInputSchema,
} from "@pcobooster/contracts/http/plan-times";
import {
  createOptimisticBasicPlanItem,
  insertPlanItem,
  replacePlanItem,
  shiftPlanItem,
  removePlanItem,
  reorderPlanItems,
} from "@pcobooster/planning-center-models/plan-item-order";
import type { PlanInsertion } from "@pcobooster/planning-center-models/plan-item-order";
import { buildEditablePlanTime } from "@pcobooster/planning-center-models/plan-time-edits";
import type {
  PlanItem,
  PlanTime,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import type { QueryClient } from "@tanstack/react-query";

import type { AppClient } from "../../app-shell/app-client";
import { OptimisticList } from "./optimistic-list";
import { requireSavedRequestIds } from "./placeholder-ids";
import type { PlaceholderIds } from "./placeholder-ids";
import { planReads } from "./reads";
import type { PlanIds } from "./reads";
import type { PlanReconciler } from "./reconcile";
import {
  applyTimeAssignments,
  replaceTimeAssignments,
} from "./time-assignments";
import type { TimeAssignments } from "./time-assignments";

type ItemCreate = Omit<
  typeof planItemsCreateInputSchema.Type,
  "serviceTypeId" | "planId"
>;
type ItemUpdate = Omit<
  typeof planItemsUpdateInputSchema.Type,
  "serviceTypeId" | "planId"
>;
type TimeCreate = Omit<
  typeof planTimesCreateInputSchema.Type,
  "serviceTypeId" | "planId"
>;
const replace = (times: PlanTime[], time: PlanTime): PlanTime[] =>
  times.map((candidate) => (candidate.id === time.id ? time : candidate));

/** Prepared inside the shared FIFO, against the editor's last acknowledged value. */
interface DeferredUpdate<T> {
  prepare: () => T | null;
  acknowledge: () => void;
}

type TimeUpdate = Omit<
  typeof planTimesUpdateInputSchema.Type,
  "serviceTypeId" | "planId"
>;

/** Items and times use the PlanWriter's ordered transport queue. */
export class PlanContentWriter {
  private readonly ids: PlanIds;
  private readonly client: AppClient;
  private readonly items: OptimisticList<PlanItem>;
  private readonly times: OptimisticList<PlanTime>;
  private readonly roster: OptimisticList<TeamPositionGroup>;
  private readonly placeholders: PlaceholderIds;
  private readonly resolvePlanPersonId: (id: string) => Promise<string>;
  private serial = 0;
  constructor(
    placeholders: PlaceholderIds,
    client: AppClient,
    cache: QueryClient,
    scope: string,
    ids: PlanIds,
    enqueue: (job: () => Promise<boolean>) => Promise<boolean>,
    onError: (error: Error) => void,
    onSuccess: () => void,
    reconciler: PlanReconciler,
    roster: OptimisticList<TeamPositionGroup>,
    resolvePlanPersonId: (id: string) => Promise<string>
  ) {
    this.resolvePlanPersonId = resolvePlanPersonId;
    this.roster = roster;
    this.placeholders = placeholders;
    this.ids = ids;
    this.client = client;
    const context = { client, scope };
    this.items = new OptimisticList(
      cache,
      planReads.items(context, ids).queryKey,
      enqueue,
      onError,
      onSuccess,
      reconciler,
      [
        { queryKey: [scope, "songs.schedule"] },
        { queryKey: [scope, "songs.options"] },
      ]
    );
    this.times = new OptimisticList(
      cache,
      planReads.times(context, ids).queryKey,
      enqueue,
      onError,
      onSuccess,
      reconciler,
      [{ queryKey: planReads.groups(context, ids).queryKey, exact: true }]
    );
  }

  private currentAssignments<
    T extends {
      assignedPlanPersonIds?: string[];
      clearedPlanPersonIds?: string[];
    },
  >(patch: T): T {
    return {
      ...patch,
      assignedPlanPersonIds: patch.assignedPlanPersonIds?.map(
        this.placeholders.resolve
      ),
      clearedPlanPersonIds: patch.clearedPlanPersonIds?.map(
        this.placeholders.resolve
      ),
    };
  }

  private async savedAssignments<
    T extends {
      assignedPlanPersonIds?: string[];
      clearedPlanPersonIds?: string[];
    },
  >(patch: T): Promise<T> {
    const assigned =
      patch.assignedPlanPersonIds === undefined
        ? undefined
        : await Promise.all(
            patch.assignedPlanPersonIds.map(this.resolvePlanPersonId)
          );
    const cleared =
      patch.clearedPlanPersonIds === undefined
        ? undefined
        : await Promise.all(
            patch.clearedPlanPersonIds.map(this.resolvePlanPersonId)
          );
    // An optimistic and saved ID can name the same desired assignment after Assign lands.
    const desired = new Set(assigned);
    return {
      ...patch,
      assignedPlanPersonIds: assigned,
      clearedPlanPersonIds: cleared?.filter((id) => !desired.has(id)),
    };
  }

  assignmentFacts(
    time: PlanTime,
    zone: string,
    acknowledged = false
  ): TimeAssignments {
    const { assignedNeededPositionIds, assignedPlanPersonIds } =
      buildEditablePlanTime(
        time,
        zone,
        acknowledged ? this.roster.acknowledged : this.roster.current
      );
    return { assignedNeededPositionIds, assignedPlanPersonIds };
  }

  observeRoster(groups: TeamPositionGroup[]): void {
    // Pending writes own their acknowledged base; a stale in-flight read cannot replace it.
    this.roster.observe(groups);
  }

  async createItem(
    input: ItemCreate,
    optimistic?: PlanItem,
    insertion?: PlanInsertion
  ): Promise<PlanItem | null> {
    this.serial += 1;
    const pending =
      optimistic ??
      createOptimisticBasicPlanItem(
        `optimistic-item-${this.serial}`,
        input.itemType ?? "item",
        0
      );
    const placement = (): PlanInsertion | undefined =>
      insertion?.afterItemId === undefined || insertion.afterItemId === null
        ? insertion
        : { afterItemId: this.placeholders.resolve(insertion.afterItemId) };
    let created: PlanItem | null = null;
    const succeeded = await this.items.write(
      (items) => insertPlanItem(items, pending, placement()),
      async (items, followUpFailed) => {
        const target = placement();
        if (target?.afterItemId !== undefined && target.afterItemId !== null) {
          this.placeholders.require(target.afterItemId);
        }
        const targetClientNative1 = this.client;
        const requestInputNative1 = {
          ...this.ids,
          ...input,
        };
        requireSavedRequestIds(requestInputNative1);
        const saved = await targetClientNative1.run((api) =>
          api.planItems.create({
            params: requestInputNative1,
            payload: requestInputNative1,
          })
        );
        created = saved;
        this.placeholders.land(pending.id, saved.id);
        const next = insertPlanItem(items, saved, target);
        if (target === undefined || next.at(-1)?.id === saved.id) {
          return next;
        }
        try {
          const targetClientNative2 = this.client;
          const requestInputNative2 = {
            ...this.ids,
            sequence: next.map((item) => item.id),
          };
          requireSavedRequestIds(requestInputNative2);
          await targetClientNative2.run((api) =>
            api.planItems.reorder({
              params: requestInputNative2,
              payload: requestInputNative2,
            })
          );
          return next;
        } catch (error) {
          // The item exists (Planning Center appended it); only its placement failed.
          followUpFailed(
            error instanceof Error
              ? error
              : new Error("Couldn't save this change.")
          );
          return insertPlanItem(items, saved);
        }
      }
    );
    return succeeded ? created : null;
  }

  async updateItem(
    input: ItemUpdate | DeferredUpdate<ItemUpdate>,
    optimistic: PlanItem
  ): Promise<boolean> {
    return await this.items.write(
      (items) =>
        replacePlanItem(items, {
          ...optimistic,
          id: this.placeholders.resolve(optimistic.id),
        }),
      async (items) => {
        const patch = "prepare" in input ? input.prepare() : input;
        if (patch === null) {
          return null;
        }
        const targetClientNative3 = this.client;
        const requestInputNative3 = {
          ...this.ids,
          ...patch,
          itemId: this.placeholders.require(patch.itemId),
        };
        requireSavedRequestIds(requestInputNative3);
        const saved = await targetClientNative3.run((api) =>
          api.planItems.update({
            params: requestInputNative3,
            payload: requestInputNative3,
          })
        );
        if ("prepare" in input) {
          input.acknowledge();
        }
        return replacePlanItem(items, saved);
      }
    );
  }

  async deleteItem(itemId: string): Promise<boolean> {
    return await this.items.write(
      (items) => removePlanItem(items, this.placeholders.resolve(itemId)),
      async (items) => {
        const id = this.placeholders.require(itemId);
        const targetClientNative4 = this.client;
        const requestInputNative4 = {
          ...this.ids,
          itemId: id,
        };
        requireSavedRequestIds(requestInputNative4);
        await targetClientNative4.run((api) =>
          api.planItems.delete({ params: requestInputNative4 })
        );
        return removePlanItem(items, id);
      }
    );
  }

  async moveItem(itemId: string, offset: -1 | 1): Promise<boolean> {
    const change = (items: PlanItem[]) =>
      shiftPlanItem(items, this.placeholders.resolve(itemId), offset);
    return await this.items.write(change, async (items) => {
      this.placeholders.require(itemId);
      const next = change(items);
      const targetClientNative5 = this.client;
      const requestInputNative5 = {
        ...this.ids,
        sequence: next.map((item) => item.id),
      };
      requireSavedRequestIds(requestInputNative5);
      await targetClientNative5.run((api) =>
        api.planItems.reorder({
          params: requestInputNative5,
          payload: requestInputNative5,
        })
      );
      return next;
    });
  }

  async dropItem(itemId: string, targetId: string): Promise<boolean> {
    const change = (items: PlanItem[]) =>
      reorderPlanItems(
        items,
        this.placeholders.resolve(itemId),
        this.placeholders.resolve(targetId)
      );
    return await this.items.write(change, async (items) => {
      this.placeholders.require(itemId);
      this.placeholders.require(targetId);
      const next = change(items);
      const targetClientNative6 = this.client;
      const requestInputNative6 = {
        ...this.ids,
        sequence: next.map((item) => item.id),
      };
      requireSavedRequestIds(requestInputNative6);
      await targetClientNative6.run((api) =>
        api.planItems.reorder({
          params: requestInputNative6,
          payload: requestInputNative6,
        })
      );
      return next;
    });
  }

  async createTime(
    input: TimeCreate,
    assignments?: Pick<
      TimeUpdate,
      "assignedNeededPositionIds" | "assignedPlanPersonIds"
    >
  ): Promise<boolean> {
    this.serial += 1;
    const pending: PlanTime = {
      id: `pending-time-${this.serial}`,
      name: input.name ?? "",
      timeType: input.timeType,
      startsAt: new Date(input.startsAt),
      endsAt:
        input.endsAt !== undefined && input.endsAt !== null
          ? new Date(input.endsAt)
          : null,
      assignedTeamIds: input.assignedTeamIds ?? [],
      assignedPositionIds: input.assignedPositionIds ?? [],
      teamReminders: [],
      splitTeamRehearsalAssignmentIds: [],
    };
    const roster = this.roster.stage((groups) =>
      applyTimeAssignments(groups, {
        planTimeId: pending.id,
        timeType: pending.timeType,
        ...this.currentAssignments(assignments ?? {}),
      })
    );
    return await this.times.write(
      (times) => [...times, pending],
      async (times, followUpFailed) => {
        let landed: TimeUpdate | null = null;
        try {
          await roster.ready;
          const targetClientNative7 = this.client;
          const requestInputNative7 = {
            ...this.ids,
            ...input,
          };
          requireSavedRequestIds(requestInputNative7);
          const saved = await targetClientNative7.run((api) =>
            api.planTimes.create({
              params: requestInputNative7,
              payload: requestInputNative7,
            })
          );
          this.placeholders.land(pending.id, saved.id);
          if (
            (assignments?.assignedNeededPositionIds?.length ?? 0) === 0 &&
            (assignments?.assignedPlanPersonIds?.length ?? 0) === 0
          ) {
            return [...times, saved];
          }
          try {
            const savedAssignments = await this.savedAssignments(
              assignments ?? {}
            );
            const targetClientNative8 = this.client;
            const requestInputNative8 = {
              ...this.ids,
              planTimeId: saved.id,
              ...savedAssignments,
            };
            requireSavedRequestIds(requestInputNative8);
            const assigned = await targetClientNative8.run((api) =>
              api.planTimes.update({
                params: requestInputNative8,
                payload: requestInputNative8,
              })
            );
            landed = {
              planTimeId: saved.id,
              timeType: saved.timeType,
              ...savedAssignments,
            };
            return [...times, assigned];
          } catch (error) {
            // The time exists; only its people and slots didn't attach.
            followUpFailed(
              error instanceof Error
                ? error
                : new Error("Couldn't save this change.")
            );
            return [...times, saved];
          }
        } finally {
          const saved = landed;
          roster.finish(
            saved === null
              ? null
              : (groups) => applyTimeAssignments(groups, saved)
          );
        }
      }
    );
  }

  async updateTime(
    input: TimeUpdate | DeferredUpdate<TimeUpdate>,
    optimistic: PlanTime,
    assignments?: () => TimeAssignments
  ): Promise<boolean> {
    const roster = this.roster.stage((groups) => {
      if (assignments !== undefined) {
        return replaceTimeAssignments(
          groups,
          optimistic.id,
          this.currentAssignments(assignments()),
          optimistic.timeType
        );
      }
      return "prepare" in input
        ? groups
        : applyTimeAssignments(groups, {
            ...this.currentAssignments(input),
            timeType: input.timeType ?? optimistic.timeType,
          });
    });
    return await this.times.write(
      (times) =>
        replace(times, {
          ...optimistic,
          id: this.placeholders.resolve(optimistic.id),
        }),
      async (times) => {
        let landed: TimeUpdate | null = null;
        try {
          await roster.ready;
          const prepared = "prepare" in input ? input.prepare() : input;
          const patch =
            prepared === null ? null : await this.savedAssignments(prepared);
          if (patch === null) {
            return null;
          }
          const targetClientNative9 = this.client;
          const requestInputNative9 = {
            ...this.ids,
            ...patch,
            planTimeId: this.placeholders.require(patch.planTimeId),
          };
          requireSavedRequestIds(requestInputNative9);
          const saved = await targetClientNative9.run((api) =>
            api.planTimes.update({
              params: requestInputNative9,
              payload: requestInputNative9,
            })
          );
          landed = {
            ...patch,
            timeType: patch.timeType ?? optimistic.timeType,
          };
          if ("prepare" in input) {
            input.acknowledge();
          }
          return replace(times, saved);
        } finally {
          const saved = landed;
          roster.finish(
            saved === null
              ? null
              : (groups) => applyTimeAssignments(groups, saved)
          );
        }
      }
    );
  }

  async deleteTime(planTimeId: string): Promise<boolean> {
    const remove = (times: PlanTime[]) =>
      times.filter((time) => time.id !== this.placeholders.resolve(planTimeId));
    const clear = (groups: TeamPositionGroup[]) =>
      replaceTimeAssignments(groups, this.placeholders.resolve(planTimeId), {
        assignedNeededPositionIds: [],
        assignedPlanPersonIds: [],
      });
    const roster = this.roster.stage(clear);
    return await this.times.write(remove, async (times) => {
      let landed = false;
      try {
        await roster.ready;
        const targetClientNative10 = this.client;
        const requestInputNative10 = {
          ...this.ids,
          planTimeId: this.placeholders.require(planTimeId),
        };
        requireSavedRequestIds(requestInputNative10);
        await targetClientNative10.run((api) =>
          api.planTimes.delete({ params: requestInputNative10 })
        );
        landed = true;
        return remove(times);
      } finally {
        roster.finish(landed ? clear : null);
      }
    });
  }
}
