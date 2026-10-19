// React Native's Xcode bundling step runs this instead of its own compose script when the
// archive sets `COMPOSE_SOURCEMAP_PATH` to it (react-native-xcode.sh honors that variable), with
// the same arguments: `<packager map> <Hermes map> -o <composed map>`.
//
// React Native deletes the packager map after composing, and its compose script drops the
// bundle's debug ID; `posthog-cli hermes clone` needs both. This keeps a copy of the packager map
// at `PCOB_PACKAGER_SOURCEMAP_COPY`, then composes exactly as React Native would. Nothing in
// `node_modules` is patched.
//
// It then writes `provenance.json` beside the copy: the packager map's debug ID and the SHA-256 of
// the packager map, Hermes's map, the composed map, and the Hermes bytecode this run compiled
// (react-native-xcode.sh writes it at the Hermes map's path without `.map`). `source-maps.ts`
// refuses maps whose files do not match it, or whose bytecode is not the archived bundle, so a
// composed map from another run is never given this bundle's identity by `hermes clone`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const [packagerMap, compilerMap] = args;
const outputIndex = args.indexOf("-o");
const composedMap = outputIndex === -1 ? undefined : args[outputIndex + 1];
const copy = String(process.env.PCOB_PACKAGER_SOURCEMAP_COPY ?? "");
if (
  packagerMap === undefined ||
  compilerMap === undefined ||
  composedMap === undefined ||
  copy === ""
) {
  throw new Error(
    "compose-source-maps needs `<packager map> <Hermes map> -o <composed map>` and PCOB_PACKAGER_SOURCEMAP_COPY."
  );
}
mkdirSync(path.dirname(copy), { recursive: true });
copyFileSync(packagerMap, copy);

const reactNativeCompose = createRequire(import.meta.url).resolve(
  "react-native/scripts/compose-source-maps"
);
execFileSync(process.execPath, [reactNativeCompose, ...args], {
  stdio: "inherit",
});

const DEBUG_ID = /"debugId"\s*:\s*"(?<id>[\da-f-]{36})"/u;

/** @param {string} file The file to hash. */
const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const bytecode = compilerMap.endsWith(".map")
  ? compilerMap.slice(0, -".map".length)
  : "";
const debugId = DEBUG_ID.exec(readFileSync(copy, "utf-8"))?.groups?.id ?? null;
writeFileSync(
  path.join(path.dirname(copy), "provenance.json"),
  `${JSON.stringify(
    {
      version: 1,
      debugId,
      packagerMapSha256: sha256(copy),
      compilerMapSha256: sha256(compilerMap),
      composedMapSha256: sha256(composedMap),
      bytecodeSha256:
        bytecode !== "" && existsSync(bytecode) ? sha256(bytecode) : null,
      clonedMapSha256: null,
    },
    null,
    2
  )}\n`
);
