import {
  DEFAULT_DEV_PORT_BASE,
  devOrigin,
  devPorts,
  parseDevPortBase,
} from "@pcobooster/config/dev-ports";
import * as Alchemy from "alchemy";
import { Config, Effect } from "effect";

const supportedStagePattern = /^(?:prod|staging|local|test|pr-\d+)$/u;

/** Where the API stack test serves the API Worker, clear of every local stage's ports. */
const testApiPort = 3010;

export interface StageSettings {
  readonly stage: string;
  readonly production: boolean;
  /**
   * True for stages that run on this machine under `alchemy dev`: `local`, and `test`, the API
   * stack test's stage (`worker.stack.test.ts`), which never shares `local`'s data or ports.
   */
  readonly local: boolean;
  /** The persistent pre-production stage, reachable only through Cloudflare Access. */
  readonly staging: boolean;
  /** The port `alchemy dev` serves the API Worker on. */
  readonly apiDevPort: number;
  /** The port `alchemy dev` serves the product Vite dev server on (local stage). */
  readonly webDevPort: number;
  /** The product's browser origin, which also serves the API. */
  readonly publicOrigin: string;
  /** Matches every preview and staging product Worker; they share production's OAuth callback. */
  readonly previewOriginPattern: string;
  /**
   * Each Worker's script name. `alchemy dev` registers local Workers by script name in one
   * machine-wide registry, and service bindings resolve through it, so a checkout running on its
   * own `DEV_PORT_BASE` carries that base in its names; otherwise its product would call whichever
   * checkout's API registered last.
   */
  readonly workerNames: WorkerNames;
}

export interface WorkerNames {
  readonly api: string;
  readonly web: string;
}

const workerNames = (prefix: string): WorkerNames => ({
  api: `${prefix}-api`,
  web: `${prefix}-web`,
});

/**
 * `devPortBase` is `DEV_PORT_BASE` (`@pcobooster/config/dev-ports`), which only the `local`
 * stage reads; several checkouts can each run their own `local` stack on different ports.
 */
export const resolveStageSettings = (
  stage: string,
  workersSubdomain: string,
  devPortBase: number = DEFAULT_DEV_PORT_BASE
): StageSettings => {
  if (!supportedStagePattern.test(stage)) {
    throw new Error(`Unsupported deployment stage: ${stage}`);
  }
  const production = stage === "prod";
  const local = stage === "local" || stage === "test";
  const ports = devPorts(devPortBase);
  const apiDevPort = stage === "test" ? testApiPort : ports.api;
  const names = workerNames(
    stage === "local" && devPortBase !== DEFAULT_DEV_PORT_BASE
      ? `pcobooster-${stage}-${devPortBase}`
      : `pcobooster-${stage}`
  );
  let publicOrigin = `https://${names.web}.${workersSubdomain}.workers.dev`;
  if (production) {
    publicOrigin = "https://pcobooster.com";
  } else if (stage === "test") {
    publicOrigin = `http://127.0.0.1:${testApiPort}`;
  } else if (local) {
    publicOrigin = devOrigin(ports.web);
  }
  return {
    stage,
    production,
    local,
    staging: stage === "staging",
    apiDevPort,
    webDevPort: ports.web,
    publicOrigin,
    previewOriginPattern: `https://pcobooster-*-web.${workersSubdomain}.workers.dev`,
    workerNames: names,
  };
};

/**
 * The current stage's settings. `Alchemy.Stack` carries the stage both while deploying and
 * inside a running Worker, so the stack and the API Worker derive identical values.
 */
export const currentStageSettings = Effect.gen(function* stageSettings() {
  const { stage } = yield* Alchemy.Stack;
  const workersSubdomain = yield* Config.String(
    "CLOUDFLARE_WORKERS_SUBDOMAIN"
  ).pipe(Config.withDefault("jakebodea"));
  // Read only locally, so deployed Workers never bind it.
  const devPortBase =
    stage === "local"
      ? yield* Config.String("DEV_PORT_BASE").pipe(Config.withDefault(""))
      : "";
  return yield* Effect.try({
    try: () =>
      resolveStageSettings(
        stage,
        workersSubdomain,
        parseDevPortBase(devPortBase)
      ),
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  }).pipe(Effect.orDie);
});
