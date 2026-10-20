import { spawn } from "node:child_process";
import { once } from "node:events";

import { readKeychain } from "./keychain";
import {
  commandEnvironment,
  parseSecretScope,
  processExit,
  requiredScopeKeys,
  selectScopeValues,
} from "./manifest";

// `--host-env` (used by `agent:run`, which loads Infisical into the environment) skips Keychain on a
// Mac too. Either way, only the `cloud` scope may come from the host.
const argv = process.argv.slice(2);
const hostOnly = argv[0] === "--host-env";
const [scopeInput, separator, command, ...args] = hostOnly
  ? argv.slice(1)
  : argv;
const scope = parseSecretScope(scopeInput);
if (separator !== "--" || command === undefined) {
  throw new Error(
    "Usage: secrets:run [--host-env] <scope> -- <command> [arguments]"
  );
}
const fromHost = hostOnly || process.platform !== "darwin";
if (fromHost && scope !== "cloud") {
  throw new Error(
    "Use GitHub environment secrets for deployed jobs; this scope requires macOS Keychain locally."
  );
}
const values = fromHost
  ? selectScopeValues(
      scope,
      Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined
        )
      )
    )
  : await readKeychain(scope);
const missing = requiredScopeKeys[scope].filter((key) => !values[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing ${scope} credentials: ${missing.join(", ")}. Run secrets:migrate to import existing values, or secrets:set to enter one securely.`
  );
}
const child = spawn(command, args, {
  stdio: "inherit",
  env: commandEnvironment(scope, process.env, values),
});
const stop = (signal: NodeJS.Signals): void => {
  child.kill(signal);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const [code] = processExit(await once(child, "exit"));
process.exitCode = code ?? 1;
