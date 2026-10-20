import { once } from "node:events";
import { createServer } from "node:net";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { findBusyPorts, resolveDevLaunch } from "./dev-launch";
import type { DevLaunchInput } from "./dev-launch";

const token = {
  PLANNING_CENTER_CLIENT: "local-client",
  PLANNING_CENTER_PAT: "local-secret",
};
const worktreeRoot = "/repo/.claude/worktrees/eloquent-dirac";

const launch = (overrides: Partial<DevLaunchInput> = {}) =>
  resolveDevLaunch({
    args: [],
    environment: token,
    repositoryRoot: "/repo",
    linkedWorktree: false,
    ...overrides,
  });

const ready = (overrides: Partial<DevLaunchInput> = {}) => {
  const result = launch(overrides);
  if (result.kind !== "ready") {
    throw new Error(result.message);
  }
  return result;
};

describe(resolveDevLaunch, () => {
  it("signs in with the personal access token by default", () => {
    const result = ready({
      environment: { ...token, DEV_AUTH_BYPASS: "", PORT: "4001" },
    });
    expect(result.oauth).toBeFalsy();
    expect(result.environment.DEV_AUTH_BYPASS).toBe("1");
    expect(result.environment).not.toHaveProperty("PORT");
  });

  it("runs OAuth on the registered default ports, even without a token", () => {
    const result = ready({
      args: ["--oauth"],
      environment: { DEV_AUTH_BYPASS: "1", PORT: "4001" },
      repositoryRoot: worktreeRoot,
      linkedWorktree: true,
    });
    expect(result.oauth).toBeTruthy();
    expect(result.portBase).toBe(3000);
    expect(result.environment.DEV_AUTH_BYPASS).toBe("");
    expect(result.environment.DEV_PORT_BASE).toBe("3000");
  });

  it("keeps the main checkout on the default ports", () => {
    expect(ready().portBase).toBe(3000);
  });

  it("gives a linked worktree its own stable block", () => {
    const result = ready({
      repositoryRoot: worktreeRoot,
      linkedWorktree: true,
    });
    expect(result.portBase).toBe(4730);
    expect(result.environment.DEV_PORT_BASE).toBe("4730");
  });

  it("puts the product on the preview tool's assigned PORT", () => {
    const result = ready({
      environment: { ...token, PORT: "51234" },
      repositoryRoot: worktreeRoot,
      linkedWorktree: true,
    });
    expect(result.portBase).toBe(51_233);
  });

  it("lets DEV_PORT_BASE override everything", () => {
    expect(
      ready({
        args: ["--oauth"],
        environment: { DEV_PORT_BASE: "5000", PORT: "4001" },
        linkedWorktree: true,
      }).portBase
    ).toBe(5000);
  });

  it("reports an invalid port setting", () => {
    const result = launch({ environment: { ...token, DEV_PORT_BASE: "80" } });
    expect(result.kind === "error" && result.message).toContain(
      "DEV_PORT_BASE"
    );
  });
});

describe(findBusyPorts, () => {
  it("finds a port another server holds", async () => {
    const server = createServer();
    server.listen({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const { port } = Schema.decodeUnknownSync(
      Schema.Struct({ port: Schema.Number })
    )(server.address());
    try {
      await expect(findBusyPorts([port])).resolves.toStrictEqual([port]);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
