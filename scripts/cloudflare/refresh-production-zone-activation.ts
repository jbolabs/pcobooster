/**
 * One-time repair of the production Zone's pre-activation deployment record.
 *
 * Alchemy beta.79 has no targeted accept-live command. This custom maintenance uses its public
 * StateService and the Zone provider's read operation; it never calls reconcile or changes DNS.
 * Default: read-only. After reviewing the report, run with --apply while production deploys are idle.
 *
 *   bun scripts/cloudflare/refresh-production-zone-activation.ts [--apply]
 */
import { isDeepStrictEqual } from "node:util";

import * as Cloudflare from "@alchemy.run/cloudflare";
import { isoDateTimeWithOffset } from "@pcobooster/contracts/http/schema";
import * as Alchemist from "alchemy/Alchemist";
import { AuthProviders } from "alchemy/Auth/AuthProvider";
import * as Provider from "alchemy/Provider";
import * as State from "alchemy/State";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { differingFields, driftValueSchema } from "./drift-report";
import type { DriftValue } from "./drift-report";

const target = { stack: "pcobooster", stage: "prod", fqn: "Zone" };
const identity = {
  name: "pcobooster.com",
  zoneId: "a43fafd2bb6e6fb47f0233e6168e622e",
  accountId: "984b82870acd18daf8bda97bad966b38",
};
const activationFields = new Set(["status", "activatedOn", "modifiedOn"]);

const zoneAttributesSchema = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    zoneId: Schema.String,
    accountId: Schema.String,
    status: Schema.Literals(["initializing", "pending", "active", "moved"]),
    activatedOn: Schema.optional(Schema.NullOr(isoDateTimeWithOffset)),
    modifiedOn: isoDateTimeWithOffset,
  }),
  [Schema.Record(Schema.String, driftValueSchema)]
);
type ZoneAttributes = typeof zoneAttributesSchema.Type;
const decodeZoneAttributes = Schema.decodeUnknownOption(zoneAttributesSchema);
const decodeDriftJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(driftValueSchema)
);

export interface RefreshDependencies {
  readonly get: () => Promise<State.PersistedState | undefined>;
  readonly observe: (state: State.ResourceState) => Promise<DriftValue>;
  readonly set: (state: State.ResourceState) => Promise<void>;
}

export interface ActivationRefreshReport {
  readonly result: "dry-run" | "applied" | "already-active";
  readonly resource: "pcobooster/prod/Zone";
  readonly name: string;
  readonly fields: readonly string[];
}

const resourceState = (
  item: State.PersistedState | undefined
): State.CreatedResourceState | State.UpdatedResourceState => {
  if (
    item === undefined ||
    State.isActionState(item) ||
    item.resourceType !== "Cloudflare.Zone.Zone" ||
    item.fqn !== target.fqn ||
    item.logicalId !== target.fqn ||
    (item.status !== "created" && item.status !== "updated")
  ) {
    throw new Error(
      "Refusing: expected a stable production Zone resource record."
    );
  }
  return item;
};

const attributes = (value: DriftValue): ZoneAttributes => {
  const result = decodeZoneAttributes(value);
  if (Option.isNone(result)) {
    throw new Error("Refusing: invalid or missing Zone attributes.");
  }
  const parsed = result.value;
  for (const [field, expected] of Object.entries(identity)) {
    if (parsed[field] !== expected) {
      throw new Error(`Refusing: Zone identity mismatch in ${field}.`);
    }
  }
  return parsed;
};

/** Reject every change except this exact zone's observed completion of activation. */
export const refreshProductionZoneActivation = async (
  dependencies: RefreshDependencies,
  apply = false
): Promise<ActivationRefreshReport> => {
  const persisted = resourceState(await dependencies.get());
  if (persisted.props.name !== identity.name) {
    throw new Error(
      "Refusing: desired Zone name differs from the verified zone."
    );
  }
  // Match drift inspection's JSON representation, where absent optional attributes are omitted.
  const expectedJson = JSON.stringify(persisted.attr);
  const expectedValue = decodeDriftJson(expectedJson);
  const expected = attributes(expectedValue);
  const observedValue = await dependencies.observe(persisted);
  const observed = attributes(observedValue);
  const fields = differingFields(expectedValue, observedValue);
  if (fields.some((field) => !activationFields.has(field))) {
    throw new Error(
      `Refusing: unexpected Zone attribute changes: ${fields.join(", ")}.`
    );
  }
  const report = {
    resource: "pcobooster/prod/Zone" as const,
    name: identity.name,
    fields,
  };
  if (expected.status === "active" && observed.status === "active") {
    return { ...report, result: "already-active" };
  }
  if (
    expected.status !== "pending" ||
    observed.status !== "active" ||
    observed.activatedOn === undefined ||
    observed.activatedOn === null
  ) {
    throw new Error(
      "Refusing: expected only a verified pending-to-active Zone transition."
    );
  }
  if (!apply) {
    return { ...report, result: "dry-run" };
  }
  const refreshed = {
    ...persisted,
    attr: {
      ...persisted.attr,
      status: observed.status,
      activatedOn: observed.activatedOn,
      modifiedOn: observed.modifiedOn,
    },
  };
  // StateService has no compare-and-set; also keep the production deploy group idle when applying.
  if (!isDeepStrictEqual(await dependencies.get(), persisted)) {
    throw new Error(
      "Refusing: Zone state changed during inspection; inspect again."
    );
  }
  await dependencies.set(refreshed);
  if (!isDeepStrictEqual(await dependencies.get(), refreshed)) {
    throw new Error("Zone state verification failed after the refresh.");
  }
  return { ...report, result: "applied" };
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== "--apply")) {
    throw new Error("Usage: refresh-production-zone-activation.ts [--apply]");
  }
  const report = await Effect.runPromise(
    Effect.gen(function* refreshZoneActivation() {
      // The app stack also loads app secrets and prepares build inputs. Resolve only the
      // same default Cloudflare store and provider services needed for this single zone read.
      const store = yield* Alchemist.State.store({
        _tag: "Provider",
        backend: "cloudflare",
      });
      const context = Context.merge(
        yield* Effect.context(),
        yield* Layer.build(
          Cloudflare.Zone.ZoneProvider().pipe(
            Layer.provideMerge(Cloudflare.CloudflareApiLive()),
            Layer.provide(Layer.succeed(AuthProviders, {}))
          )
        )
      );
      const provider = yield* Provider.findProviderByType(
        "Cloudflare.Zone.Zone",
        "live"
      ).pipe(Effect.provide(context));
      const read = provider.read?.bind(provider);
      if (read === undefined) {
        throw new Error(
          "Refusing: the installed Zone provider cannot read live attributes."
        );
      }
      return yield* Effect.promise(
        async () =>
          await refreshProductionZoneActivation(
            {
              get: async () => await Effect.runPromise(store.get(target)),
              observe: async (state) => {
                const observed = await Effect.runPromise(
                  read({
                    id: state.logicalId,
                    fqn: state.fqn,
                    instanceId: state.instanceId,
                    olds: state.props,
                    output: state.attr,
                  }).pipe(Effect.provide(context))
                );
                const observedJson = JSON.stringify(observed ?? null);
                return decodeDriftJson(observedJson);
              },
              set: async (value) => {
                await Effect.runPromise(store.set({ ...target, value }));
              },
            },
            args.includes("--apply")
          )
      );
    }).pipe(Effect.provide(Alchemist.layer()), Effect.scoped)
  );
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
