import { execFileSync } from "node:child_process";
import { cpSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import type { ExpoConfig } from "expo/config";
import type { ConfigPlugin } from "expo/config-plugins";
import { withDangerousMod } from "expo/config-plugins";

import { iosBuildNumber } from "./scripts/build-number.ts";

const catalogDirectory = path.join(import.meta.dirname, "assets/catalog");
const catalogEntry = /\.(?:symbolset|imageset)$/u;

/**
 * Copies `assets/catalog` (the custom symbols SF Symbols lacks, the drum and the rocket glyph,
 * and the Planning Center and rocket images) into the generated asset catalog, so SwiftUI
 * `Image(assetName:)` finds them by name.
 */
const withCatalogAssets: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    "ios",
    (next) => {
      const catalog = path.join(
        next.modRequest.platformProjectRoot,
        next.modRequest.projectName ?? "PCOBooster",
        "Images.xcassets"
      );
      for (const entry of readdirSync(catalogDirectory)) {
        if (catalogEntry.test(entry)) {
          cpSync(
            path.join(catalogDirectory, entry),
            path.join(catalog, entry),
            {
              recursive: true,
            }
          );
        }
      }
      return next;
    },
  ]);

/**
 * Whether ccache is on this machine's PATH. Prebuild writes the answer into
 * `Podfile.properties.json`, so a machine or CI runner without ccache compiles with plain clang.
 */
const hasCcache = (): boolean => {
  try {
    execFileSync("/bin/sh", ["-c", "command -v ccache"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/**
 * Release builds ask pcobooster.com for signed JavaScript updates at launch; see
 * docs/ci-cd.md#ios-updates-over-the-air. A rehearsal build asks the local stack instead
 * (`PCOB_UPDATES_URL`, which release archives refuse). The release smoke build answers every
 * request from fixtures, so it never asks: it must test the JavaScript it was built with.
 */
const updates: ExpoConfig["updates"] = {
  url: String(
    process.env.PCOB_UPDATES_URL ??
      "https://pcobooster.com/api/updates/manifest"
  ),
  enabled: (process.env.EXPO_PUBLIC_PCOB_RELEASE_SMOKE ?? "") === "",
  checkAutomatically: "ON_LOAD",
  // Launch at once with the code already on the phone; a downloaded update runs next launch.
  fallbackToCacheTimeout: 0,
  codeSigningCertificate: "./certs/updates-certificate.pem",
  codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
};

const config: ExpoConfig = {
  name: "PCOBooster",
  slug: "pcobooster",
  version: "0.1.0",
  // Release links use `pcobooster://`; development builds also answer `pcobooster-dev://`.
  scheme: ["pcobooster", "pcobooster-dev"],
  orientation: "default",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.pcobooster.ios",
    deploymentTarget: "16.4",
    icon: "./assets/app-icon.icon",
    // iPhone and iPad share the supported feature workflows; Android remains deferred.
    supportsTablet: true,
    infoPlist: {
      CADisableMinimumFrameDurationOnPhone: true,
      ITSAppUsesNonExemptEncryption: false,
      LSApplicationCategoryType: "public.app-category.productivity",
    },
  },
  plugins: [
    "expo-router",
    // Without scene support the app cannot launch on the iOS 27 SDK.
    [
      "expo-build-properties",
      { ios: { ccacheEnabled: hasCcache(), enableSceneSupport: true } },
    ],
  ],
  experiments: { typedRoutes: false },
  // An update reaches only builds whose native layer it fits (`fingerprint.config.cjs`).
  runtimeVersion: { policy: "fingerprint" },
  updates,
};

const appConfig = (): ExpoConfig =>
  withCatalogAssets({
    ...config,
    ios: {
      ...config.ios,
      buildNumber: iosBuildNumber(String(process.env.BUILD_NUMBER ?? "1")),
    },
  });

export default appConfig;
