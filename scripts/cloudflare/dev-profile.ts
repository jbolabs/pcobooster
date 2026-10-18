import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import { Schema } from "effect";

import {
  makeSandboxApi,
  sandboxOrganization,
} from "../planning-center-sandbox/api";
import { readKeychain } from "../secrets/keychain";
import { commandEnvironment, processExit } from "../secrets/manifest";
import { isLinkedWorktree, resolveDevLaunch } from "./dev-launch";
import {
  churchOrganization,
  resolveDevelopmentProfile,
} from "./dev-profile-config";

const identitySchema = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    attributes: Schema.Struct({ name: Schema.String }),
  }),
});
const args = process.argv.slice(2);
const profile = resolveDevelopmentProfile(args);
const local = await readKeychain("local");
const credentials =
  profile.kind === "sandbox" ? await readKeychain("sandbox") : local;
const client = credentials.PLANNING_CENTER_CLIENT ?? "";
const token = credentials.PLANNING_CENTER_PAT ?? "";
if (!client || !token) {
  throw new Error(`Missing Planning Center credentials for ${profile.kind}.`);
}
if (profile.kind === "sandbox") {
  await makeSandboxApi(client, token).verify();
} else {
  // This identity probe is GET-only. The sandbox provisioning client never accepts church credentials.
  const response = await fetch(
    "https://api.planningcenteronline.com/services/v2",
    {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${client}:${token}`).toString("base64")}`,
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Church identity check failed: HTTP ${response.status}`);
  }
  const json: unknown = await response.json();
  const { data } = Schema.decodeUnknownSync(identitySchema)(json);
  if (
    data.id !== churchOrganization.id ||
    data.attributes.name !== churchOrganization.name
  ) {
    throw new Error(
      "The church profile credentials do not belong to the pinned Agape organization."
    );
  }
}
const environment = commandEnvironment("local", process.env, {
  ...local,
  PLANNING_CENTER_CLIENT: client,
  PLANNING_CENTER_PAT: token,
});
environment.DEV_PLANNING_CENTER_ACCESS = profile.readOnly ? "read" : "write";
environment.DEV_DATA_PROFILE = profile.label;
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
const organization =
  profile.kind === "sandbox" ? sandboxOrganization : churchOrganization;
process.stdout.write(
  `Verified ${organization.name} (${organization.id}) · ${profile.label}\n`
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
