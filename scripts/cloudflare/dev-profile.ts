import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import {
  makeSandboxApi,
  sandboxOrganization,
} from "../planning-center-sandbox/api";
import { readKeychain } from "../secrets/keychain";
import { developmentEnvironment, processExit } from "../secrets/manifest";
import { isLinkedWorktree, resolveDevLaunch } from "./dev-launch";
import {
  churchOrganization,
  resolveDevelopmentProfile,
} from "./dev-profile-config";

const args = process.argv.slice(2);
const profile = resolveDevelopmentProfile(args);
// App and OAuth settings and the church PAT come from Infisical `pcobooster-dev` inside Alchemy.
// The sandbox profile overrides the PAT with the test organization's, verified here first.
let sandbox: Record<string, string> = {};
if (profile.kind === "sandbox") {
  sandbox = await readKeychain("sandbox");
  const client = sandbox.PLANNING_CENTER_CLIENT ?? "";
  const token = sandbox.PLANNING_CENTER_PAT ?? "";
  if (client === "" || token === "") {
    throw new Error("Missing Planning Center credentials for sandbox.");
  }
  await makeSandboxApi(client, token).verify();
}
const organization =
  profile.kind === "sandbox" ? sandboxOrganization : churchOrganization;
const environment = developmentEnvironment(process.env, sandbox);
environment.DEV_PLANNING_CENTER_ACCESS = profile.readOnly ? "read" : "write";
// The stack refuses a token from any other organization (`dev-organization.ts`).
environment.DEV_PLANNING_CENTER_ORGANIZATION = organization.id;
if (args.includes("--present")) {
  environment.PRESENTATION_MODE = "1";
}
if (profile.kind !== "sandbox") {
  const root = path.resolve(import.meta.dirname, "../..");
  const launch = resolveDevLaunch({
    args: [],
    environment,
    repositoryRoot: root,
    linkedWorktree: isLinkedWorktree(root),
  });
  if (launch.kind === "error") {
    throw new Error(launch.message);
  }
  // Separate browser origins also separate persisted query caches between church and sandbox.
  environment.DEV_PORT_BASE = String(launch.portBase + 4);
}
process.stdout.write(
  `${profile.kind === "sandbox" ? "Verified" : "Requiring"} ${organization.name} (${organization.id}) · ${profile.label}\n`
);
const child = spawn("bun", ["run", "scripts/cloudflare/dev.ts"], {
  env: environment,
  stdio: "inherit",
});
const stop = (signal: NodeJS.Signals): void => {
  child.kill(signal);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const [code] = processExit(await once(child, "exit"));
process.exitCode = code ?? 1;
