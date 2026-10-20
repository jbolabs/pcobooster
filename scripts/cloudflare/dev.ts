import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import { devOrigin, devPorts } from "@pcobooster/config/dev-ports";
import { Schema } from "effect";

import { developmentEnvironment } from "../secrets/manifest";
import {
  findBusyPorts,
  isLinkedWorktree,
  resolveDevLaunch,
} from "./dev-launch";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const launch = resolveDevLaunch({
  args,
  // OAuth (`dev:auth`) starts from the shell, so drop stale credentials that would outrank
  // Infisical. The PAT profiles arrive from `dev-profile.ts`, which already prepared theirs.
  environment: args.includes("--oauth")
    ? developmentEnvironment(process.env, {})
    : process.env,
  repositoryRoot,
  linkedWorktree: isLinkedWorktree(repositoryRoot),
});
if (launch.kind === "error") {
  process.stderr.write(`${launch.message}\n`);
  process.exit(1);
}
const ports = devPorts(launch.portBase);
const busy = await findBusyPorts(Object.values(ports));
if (busy.length > 0) {
  process.stderr.write(
    `${busy.length === 1 ? "Port" : "Ports"} ${busy.join(", ")} ${busy.length === 1 ? "is" : "are"} in use, probably by another checkout's dev server. Stop it, or pick free ports with DEV_PORT_BASE=<port> bun run dev.\n`
  );
  process.exit(1);
}
process.stdout.write(
  [
    `Product ${devOrigin(ports.web)} (${launch.oauth ? "Planning Center sign-in" : "signed in with the personal access token"})`,
    `API ${devOrigin(ports.api)}, marketing ${devOrigin(ports.marketing)}, admin ${devOrigin(ports.admin)}`,
    "",
  ].join("\n")
);

// Alchemy runs the product and admin Vite dev servers with their Workers bindings and applies
// local D1 migrations. The product proxies `/`, `/about`, and `/marketing/*` to marketing.
const processes = [
  // Only Alchemy reads Infisical credentials; the marketing dev server never sees them.
  spawn("bun", ["run", "dev:marketing"], {
    stdio: "inherit",
    env: Object.fromEntries(
      Object.entries(launch.environment).filter(
        ([key]) => !key.startsWith("INFISICAL_")
      )
    ),
  }),
  spawn("bun", ["run", "alchemy", "dev", "--stage", "local", "--no-input"], {
    stdio: "inherit",
    env: launch.environment,
  }),
];
const stop = () => {
  for (const child of processes) {
    child.kill("SIGTERM");
  }
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const exits = processes.map(async (child) => {
  const [code] = Schema.decodeUnknownSync(
    Schema.Tuple([Schema.NullOr(Schema.Number), Schema.NullOr(Schema.String)])
  )(await once(child, "exit"));
  return code ?? 0;
});
try {
  process.exitCode = await Promise.race(exits);
} finally {
  stop();
  await Promise.allSettled(exits);
}
