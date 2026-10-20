/**
 * The release steps `release-ios.sh` runs outside Xcode. Every App Store Connect call is a read.
 *
 * Usage: bun run scripts/release/release-cli.ts <command>
 *   export-options [--has-key]                  Prints validated local export options plist.
 *   signing [--has-key]                         Prints api-key or xcode-account.
 *   lock acquire --pid <pid> --revision <sha>   Takes this machine's release lock.
 *   lock release --pid <pid>
 *   build-number choose --pid <pid> --revision <sha> [--requested <n>]
 *                                               Prints and claims the release's build number.
 *   build-number verify --build <n>             Fails if App Store Connect now has it, or higher.
 *   status --build <n>                          Prints the build's processing and TestFlight state.
 *   builds [--limit <n>]                        Prints the newest builds (default 10) and any
 *                                               upload App Store Connect has not listed yet.
 *   latest                                      The same for the newest build only.
 *   analytics-key                               Prints the PostHog key release archives embed.
 *
 * App Store Connect reads use ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_PATH or ASC_KEY_P8_BASE64
 * from the environment this command alone receives.
 */
import process from "node:process";

import {
  ascKeyFromEnv,
  buildState,
  findAppId,
  makeAscClient,
  recentBuilds,
  takenBuildNumbers,
} from "./asc";
import type { AscClient } from "./asc";
import {
  chooseBuildNumber,
  exportOptionsPlist,
  parseBuildNumber,
  releaseAnalyticsKey,
  signingMode,
  stillUnused,
} from "./release-rules";
import {
  acquireLock,
  assertLockHeld,
  claimedBuildNumbers,
  recordClaim,
  releaseLock,
  releaseStateDir,
} from "./release-state";

const BUNDLE_ID = "com.pcobooster.ios";
const DEFAULT_BUILD_LIST = 10;
/** App Store Connect's largest page; the list reads one page. */
const MAX_BUILD_LIST = 200;

const option = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
};

const required = (args: readonly string[], name: string): string => {
  const value = option(args, name);
  if (value === null) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const pidOption = (args: readonly string[]): number => {
  const pid = Number(required(args, "--pid"));
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("--pid must be a process id");
  }
  return pid;
};

const limitOption = (args: readonly string[]): number => {
  const value = option(args, "--limit");
  const limit = value === null ? DEFAULT_BUILD_LIST : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BUILD_LIST) {
    throw new Error(
      `--limit must be a whole number from 1 to ${MAX_BUILD_LIST}.`
    );
  }
  return limit;
};

/** The App Store Connect reader and the app's id, or null without a key. */
const appStoreConnect = async (): Promise<{
  client: AscClient;
  appId: string;
} | null> => {
  const key = ascKeyFromEnv(process.env);
  if (key === null) {
    return null;
  }
  const client = makeAscClient(key);
  return { client, appId: await findAppId(client, BUNDLE_ID) };
};

type Command = (args: readonly string[]) => Promise<void>;

const listBuilds = async (limit: number): Promise<void> => {
  const asc = await appStoreConnect();
  if (asc === null) {
    throw new Error(
      "Listing builds reads App Store Connect and needs an API key."
    );
  }
  const recent = await recentBuilds(asc.client, asc.appId, limit);
  console.log(JSON.stringify(recent, null, 2));
};

const commands = {
  "export-options": async (args) => {
    await Promise.resolve();
    console.log(
      exportOptionsPlist({
        env: process.env,
        hasKey: args.includes("--has-key"),
      })
    );
  },
  signing: async (args) => {
    await Promise.resolve();
    console.log(
      signingMode({ env: process.env, hasKey: args.includes("--has-key") })
    );
  },
  lock: async (args) => {
    await Promise.resolve();
    const dir = releaseStateDir();
    const pid = pidOption(args);
    if (args[0] === "acquire") {
      acquireLock(dir, {
        pid,
        revision: required(args, "--revision"),
        startedAt: new Date().toISOString(),
      });
    } else if (args[0] === "release") {
      releaseLock(dir, pid);
    } else {
      throw new Error("lock acquire|release");
    }
  },
  "build-number": async (args) => {
    const asc = await appStoreConnect();
    const used =
      asc === null ? null : await takenBuildNumbers(asc.client, asc.appId);
    if (args[0] === "choose") {
      const dir = releaseStateDir();
      assertLockHeld(dir, pidOption(args));
      const requested = option(args, "--requested");
      const build = chooseBuildNumber(
        { appStoreConnect: used, claimed: claimedBuildNumbers(dir) },
        requested === null ? null : parseBuildNumber(requested)
      );
      recordClaim(dir, build, required(args, "--revision"), new Date());
      if (used === null) {
        console.error(
          `Build ${build} is above the floor and every local claim. Without an API key, App Store Connect was not checked; Apple rejects a used number at upload, and the release does not retry.`
        );
      }
      console.log(build);
    } else if (args[0] === "verify") {
      const build = parseBuildNumber(required(args, "--build"));
      if (used === null) {
        throw new Error(
          `BLOCKED: build ${build} cannot be validated without an App Store Connect read key. No upload is permitted.`
        );
      }
      stillUnused(build, used);
      console.error(
        `Build ${build} is still above every App Store Connect build and upload.`
      );
    } else {
      throw new Error("build-number choose|verify");
    }
  },
  status: async (args) => {
    const asc = await appStoreConnect();
    if (asc === null) {
      throw new Error("status reads App Store Connect and needs an API key.");
    }
    const build = parseBuildNumber(required(args, "--build"));
    const state = await buildState(asc.client, asc.appId, build);
    console.log(JSON.stringify(state ?? { build, found: false }, null, 2));
    if (state === null) {
      process.exitCode = 1;
    }
  },
  builds: async (args) => {
    await listBuilds(limitOption(args));
  },
  latest: async () => {
    await listBuilds(1);
  },
  "analytics-key": async () => {
    await Promise.resolve();
    console.log(releaseAnalyticsKey(process.env));
  },
} satisfies Record<string, Command>;

const [name, ...rest] = process.argv.slice(2);
const isCommandName = (value: string): value is keyof typeof commands =>
  Object.hasOwn(commands, value);
const command: Command | undefined =
  name !== undefined && isCommandName(name) ? commands[name] : undefined;
if (command === undefined) {
  console.error(
    "Usage: release-cli.ts signing|export-options|lock|build-number|status|builds|latest|analytics-key ..."
  );
  process.exitCode = 64;
} else {
  try {
    await command(rest);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
