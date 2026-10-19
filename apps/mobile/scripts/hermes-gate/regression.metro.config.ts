/**
 * The app's Metro configuration (Expo's default; the app has no metro.config.js) with one source
 * file resolved to another, for the Release Hermes gate's regression probe. The gate passes it
 * through EXPO_OVERRIDE_METRO_CONFIG, because `expo export:embed` ignores --config.
 * PCOB_HERMES_GATE_SUBSTITUTE is `<original>=<replacement>`, both absolute paths.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Schema } from "effect";
import { getDefaultConfig } from "expo/metro-config";

const [original, replacement] = Schema.decodeUnknownSync(Schema.String)(
  process.env.PCOB_HERMES_GATE_SUBSTITUTE ?? ""
).split("=");
if (
  original === undefined ||
  original === "" ||
  replacement === undefined ||
  replacement === ""
) {
  throw new Error(
    "PCOB_HERMES_GATE_SUBSTITUTE must be <original>=<replacement>"
  );
}

const config = getDefaultConfig(path.resolve(import.meta.dirname, "../.."));
const upstream = config.resolver?.resolveRequest;

export default {
  ...config,
  resolver: {
    ...config.resolver,
    resolveRequest: (context, moduleName, platform) => {
      const resolved = upstream
        ? upstream(context, moduleName, platform)
        : context.resolveRequest(context, moduleName, platform);
      // Workspace packages resolve through node_modules symlinks.
      return resolved.type === "sourceFile" &&
        realpathSync(resolved.filePath) === original
        ? { type: "sourceFile", filePath: replacement }
        : resolved;
    },
  },
} satisfies typeof config;
