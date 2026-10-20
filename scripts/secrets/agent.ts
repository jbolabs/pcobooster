import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import { agentInfisicalProject, processExit } from "./manifest";

// Agent entry point: loads `pcobooster-dev` from Infisical, then hands it to `secrets:run`, whose
// `cloud` allowlist decides what the command sees and strips every INFISICAL_* variable from it.
const command = process.argv.slice(2);
if (command.length === 0) {
  throw new Error("Usage: agent:run <command> [arguments]");
}

/** A machine identity access token, from the environment or a Universal Auth login. Never printed. */
const accessToken = async (): Promise<string> => {
  const existing = process.env.INFISICAL_TOKEN ?? "";
  if (existing !== "") {
    return existing;
  }
  const clientId = process.env.INFISICAL_CLIENT_ID ?? "";
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET ?? "";
  if (clientId === "" || clientSecret === "") {
    throw new Error(
      "Set INFISICAL_TOKEN, or INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET for the agent-dev identity."
    );
  }
  const login = spawn(
    "infisical",
    [
      "login",
      "--method=universal-auth",
      `--client-id=${clientId}`,
      `--client-secret=${clientSecret}`,
      "--silent",
      "--plain",
    ],
    { stdio: ["ignore", "pipe", "ignore"] }
  );
  const chunks: Buffer[] = [];
  login.stdout.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  const [code] = processExit(await once(login, "close"));
  const token = Buffer.concat(chunks).toString().trim();
  if (code !== 0 || token === "") {
    throw new Error(
      "Infisical Universal Auth login failed; check the agent-dev client ID and secret."
    );
  }
  return token;
};

const child = spawn(
  "infisical",
  [
    "run",
    `--projectId=${agentInfisicalProject.projectId}`,
    `--env=${agentInfisicalProject.environment}`,
    "--silent",
    "--",
    "bun",
    path.join(import.meta.dirname, "run.ts"),
    "--host-env",
    "cloud",
    "--",
    ...command,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, INFISICAL_TOKEN: await accessToken() },
  }
);
const stop = (signal: NodeJS.Signals): void => {
  child.kill(signal);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const [code] = processExit(await once(child, "exit"));
process.exitCode = code ?? 1;
