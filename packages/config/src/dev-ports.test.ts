import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEV_PORT_BASE,
  devPorts,
  parseDevPortBase,
  readDevPorts,
  worktreeDevPortBase,
} from "./dev-ports.ts";

describe("dev ports", () => {
  it("places the stack on consecutive ports from the base", () => {
    expect(devPorts(4020)).toStrictEqual({
      api: 4020,
      web: 4021,
      marketing: 4022,
    });
  });

  it("keeps the main checkout's ports when DEV_PORT_BASE is unset", () => {
    expect(readDevPorts({})).toStrictEqual(devPorts(3000));
    expect(parseDevPortBase("  ")).toBe(DEFAULT_DEV_PORT_BASE);
    expect(parseDevPortBase(" 5100 ")).toBe(5100);
  });

  it.each(["abc", "3000.5", "-1", "80", "65534", "1e4"])(
    "rejects DEV_PORT_BASE %s",
    (value) => {
      expect(() => parseDevPortBase(value)).toThrow(/DEV_PORT_BASE/u);
    }
  );

  it("derives a stable worktree block clear of the default and test ports", () => {
    const path = "/Users/dev/pcobooster/.claude/worktrees/eloquent-dirac";
    const base = worktreeDevPortBase(path);
    expect(worktreeDevPortBase(path)).toBe(base);
    expect(base % 10).toBe(0);
    expect(base).toBeGreaterThanOrEqual(4000);
    expect(base).toBeLessThan(5000);
  });

  it("spreads worktrees across blocks", () => {
    const bases = new Set(
      Array.from({ length: 20 }, (_, index) =>
        worktreeDevPortBase(`/repo/.claude/worktrees/tree-${index}`)
      )
    );
    expect(bases.size).toBeGreaterThan(10);
  });
});
