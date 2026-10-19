/**
 * The Release Hermes gate's probe: the app's polyfills, then the production contracts and the
 * typed product client, initialized the way the app's runtime does at launch. Metro bundles it
 * with the app's production transform and hermesc compiles it as Xcode does; `runner.cpp` runs
 * the bytecode in the shipped engine. A module-load failure surfaces as the runner's uncaught
 * exception, exactly as it aborts the app.
 */
import "../../src/runtime-polyfills";
import { makeProductClient } from "@pcobooster/client/product-client";
import {
  ProductApi,
  ProductWireApi,
  procedureRoutes,
} from "@pcobooster/contracts/http/api";

declare const __pcobReport: (json: string) => void;
/** Hermes' own description of the engine: its release, bytecode version, and build. */
declare const HermesInternal: {
  readonly getRuntimeProperties: () => object;
};

const client = makeProductClient({
  url: "https://probe.invalid",
  client: "expo",
  credentials: "omit",
  // Construction must not touch the network; a call here is a failure.
  fetch: async () =>
    await Promise.reject(new Error("The startup probe made a network request")),
  httpHeaders: () => ({}),
});

__pcobReport(
  JSON.stringify({
    status: "PASS",
    api: ProductApi.identifier,
    wireApi: ProductWireApi.identifier,
    groups: Object.keys(client.api),
    routes: procedureRoutes.map((route) => ({
      tag: route.tag,
      method: route.method,
      path: route.path,
      params: route.params,
    })),
    runtime: HermesInternal.getRuntimeProperties(),
  })
);
