/**
 * Local dev server ports. One setting, `DEV_PORT_BASE`, places the whole stack so several
 * checkouts can run `bun run dev` at once: the API on the base, then the product and
 * marketing on the next two ports. `scripts/cloudflare/dev.ts` chooses the base and passes it
 * to every dev server; each reads it back with `readDevPorts`.
 */

/** The main checkout's ports; Planning Center's local OAuth callback is registered on its product port. */
export const DEFAULT_DEV_PORT_BASE = 3000;

const PORT_COUNT = 3;
const MAX_PORT = 65_535;
const MIN_UNPRIVILEGED_PORT = 1024;

/** Linked worktrees get one of these blocks, clear of 3000 and the API stack test's 3010. */
const WORKTREE_BLOCK_START = 4000;
const WORKTREE_BLOCK_SIZE = 10;
const WORKTREE_BLOCK_COUNT = 100;

export interface DevPorts {
  readonly api: number;
  readonly web: number;
  readonly marketing: number;
}

export const devPorts = (base: number): DevPorts => ({
  api: base,
  web: base + 1,
  marketing: base + 2,
});

export const devOrigin = (port: number): string => `http://127.0.0.1:${port}`;

const integerPattern = /^\d+$/u;

/** Parses a `DEV_PORT_BASE` value; unset or blank means the default. */
export const parseDevPortBase = (value: string | undefined): number => {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return DEFAULT_DEV_PORT_BASE;
  }
  const base = integerPattern.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (
    !Number.isSafeInteger(base) ||
    base < MIN_UNPRIVILEGED_PORT ||
    base + PORT_COUNT - 1 > MAX_PORT
  ) {
    throw new Error(
      `DEV_PORT_BASE must be an integer from ${MIN_UNPRIVILEGED_PORT} to ${MAX_PORT - PORT_COUNT + 1}, got "${trimmed}"`
    );
  }
  return base;
};

/** The ports a dev server should use, from its process environment. */
export const readDevPorts = (
  environment: Readonly<Record<string, string | undefined>>
): DevPorts => devPorts(parseDevPortBase(environment.DEV_PORT_BASE));

const HASH_MODULUS = 2_147_483_647;
const HASH_MULTIPLIER = 31;

/** A polynomial string hash: stable across machines and runtimes, and needs no crypto. */
const hashText = (text: string): number => {
  let hash = 0;
  for (const character of text) {
    hash =
      (hash * HASH_MULTIPLIER + (character.codePointAt(0) ?? 0)) % HASH_MODULUS;
  }
  return hash;
};

/** A linked worktree's stable default base, derived from its checkout path. */
export const worktreeDevPortBase = (checkoutPath: string): number =>
  WORKTREE_BLOCK_START +
  (hashText(checkoutPath) % WORKTREE_BLOCK_COUNT) * WORKTREE_BLOCK_SIZE;
