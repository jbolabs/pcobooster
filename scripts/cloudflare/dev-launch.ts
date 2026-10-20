import { once } from "node:events";
import { statSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import {
  DEFAULT_DEV_PORT_BASE,
  parseDevPortBase,
  worktreeDevPortBase,
} from "@pcobooster/config/dev-ports";

type Environment = Readonly<Record<string, string | undefined>>;

export interface DevLaunchInput {
  /** `bun run dev` arguments; `--oauth` signs in through Planning Center instead of the PAT. */
  readonly args: readonly string[];
  readonly environment: Environment;
  readonly repositoryRoot: string;
  /** A linked `git worktree` rather than the main checkout. */
  readonly linkedWorktree: boolean;
}

export type DevLaunch =
  | {
      readonly kind: "ready";
      readonly oauth: boolean;
      readonly portBase: number;
      /** The dev servers' environment: `DEV_PORT_BASE` and `DEV_AUTH_BYPASS` set, `PORT` removed. */
      readonly environment: Record<string, string | undefined>;
    }
  | { readonly kind: "error"; readonly message: string };

const isSet = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

/**
 * Where the stack listens, in order: an explicit `DEV_PORT_BASE`; the default for OAuth, since
 * Planning Center only redirects to the registered `127.0.0.1:3001` callback; the product port
 * the desktop preview tool assigns in `PORT`; a stable per-worktree block; the default.
 */
const resolvePortBase = (
  { environment, repositoryRoot, linkedWorktree }: DevLaunchInput,
  oauth: boolean
): number => {
  if (isSet(environment.DEV_PORT_BASE)) {
    return parseDevPortBase(environment.DEV_PORT_BASE);
  }
  if (oauth) {
    return DEFAULT_DEV_PORT_BASE;
  }
  if (isSet(environment.PORT)) {
    return parseDevPortBase(String(Number(environment.PORT.trim()) - 1));
  }
  return linkedWorktree
    ? worktreeDevPortBase(repositoryRoot)
    : DEFAULT_DEV_PORT_BASE;
};

export const resolveDevLaunch = (input: DevLaunchInput): DevLaunch => {
  // The personal access token may come from Infisical inside Alchemy, so the stack, not this
  // launcher, refuses a missing or foreign token (`scripts/cloudflare/dev-organization.ts`).
  const oauth = input.args.includes("--oauth");
  const { environment } = input;
  let portBase: number;
  try {
    portBase = resolvePortBase(input, oauth);
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const { PORT: _assignedPort, ...inherited } = environment;
  return {
    kind: "ready",
    oauth,
    portBase,
    environment: {
      ...inherited,
      DEV_PORT_BASE: String(portBase),
      // The command decides: the PAT by default, OAuth with `--oauth`.
      DEV_AUTH_BYPASS: oauth ? "" : "1",
    },
  };
};

/** A linked worktree's `.git` is a file pointing at the main repository's. */
export const isLinkedWorktree = (repositoryRoot: string): boolean => {
  try {
    return statSync(path.join(repositoryRoot, ".git")).isFile();
  } catch {
    return false;
  }
};

const isPortFree = async (port: number): Promise<boolean> => {
  const server = createServer();
  server.listen({ host: "127.0.0.1", port, exclusive: true });
  try {
    await once(server, "listening");
  } catch {
    return false;
  }
  server.close();
  await once(server, "close");
  return true;
};

/** The ports already taken on 127.0.0.1. */
export const findBusyPorts = async (
  ports: readonly number[]
): Promise<number[]> => {
  const free = await Promise.all(ports.map(isPortFree));
  return ports.filter((_, index) => !free[index]);
};
