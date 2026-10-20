import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import { infisicalSource } from "../../stacks/secrets";
import { processExit } from "./manifest";

// `secrets:dev`: development credentials for commands Alchemy does not run (for example
// `pc:check-contracts`). Alchemy stacks read Infisical natively; this exists only for scripts that
// read `process.env`. It loads `pcobooster-dev` with the Infisical CLI and hands it to
// `secrets:run --host-env cloud`, whose allowlist decides what the command sees and which strips
// every INFISICAL_* variable from it.
const command = process.argv.slice(2);
if (command.length === 0) {
  throw new Error("Usage: secrets:dev <command> [arguments]");
}

/**
 * `INFISICAL_TOKEN`, else a Universal Auth login with the `agent-dev` identity's
 * `INFISICAL_CLIENT_ID`/`INFISICAL_CLIENT_SECRET`, else the CLI's own `infisical login` session.
 * The token is never printed.
 */
const accessToken = async (): Promise<string | undefined> => {
  const existing = process.env.INFISICAL_TOKEN ?? "";
  if (existing !== "") {
    return existing;
  }
  const clientId = process.env.INFISICAL_CLIENT_ID ?? "";
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET ?? "";
  if (clientId === "" || clientSecret === "") {
    return undefined;
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

const source = infisicalSource("local");
const token = await accessToken();
const child = spawn(
  "infisical",
  [
    "run",
    `--projectId=${source.project}`,
    `--env=${source.environment}`,
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
    env:
      token === undefined
        ? process.env
        : { ...process.env, INFISICAL_TOKEN: token },
  }
);
const stop = (signal: NodeJS.Signals): void => {
  child.kill(signal);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const [code] = processExit(await once(child, "exit"));
process.exitCode = code ?? 1;
