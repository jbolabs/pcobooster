#!/usr/bin/env bash
# Prepare an unsigned archive or explicitly export a signed IPA. Never uploads.
# Usage: bun run ios:release [--prepare | --no-upload] [--skip-build]
# --prepare (default) creates and validates an unsigned archive without signing credentials.
# --no-upload signs and exports an IPA without uploading it.
# --skip-build exports the existing archive only if it matches this clean revision.
# BUILD_NUMBER picks the build number; with an API key the next free one is the default.
# Every archive embeds pcobooster.com's public PostHog key from source; one without it never exports.
set -euo pipefail

mobile="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$mobile/../.." && pwd)"
out="$mobile/build/release"
archive="$out/PCOBooster.xcarchive"
destination=prepare
skip_build=0
for argument in "$@"; do
  case "$argument" in
    --prepare) destination=prepare ;;
    --no-upload) destination=export ;;
    --upload)
      echo "BLOCKED: uploads belong to the explicitly dispatched ios-release workflow. Its uploader is disabled until isolated signing and environment protection are proven. Local commands only prepare or export." >&2
      exit 64 ;;
    --skip-build) skip_build=1 ;;
    --) ;;
    -h | --help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $argument" >&2; exit 64 ;;
  esac
done

assert_clean() {
  if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=all)" ]]; then
    echo "Refusing to release uncommitted source. Commit tracked changes and untracked source first." >&2
    exit 1
  fi
}
assert_clean
revision="$(git -C "$repo" rev-parse HEAD)"
if [[ -n "${EXPO_PUBLIC_DIAGNOSTICS_PROBES:-}" ]]; then
  echo "Diagnostic probes belong to a separate internal verification build; unset them to release." >&2
  exit 64
fi
if [[ -n "${EXPO_PUBLIC_PCOB_RELEASE_SMOKE:-}" ]]; then
  echo "EXPO_PUBLIC_PCOB_RELEASE_SMOKE builds the fixture smoke app; unset it to release." >&2
  exit 64
fi
if [[ -n "${PCOB_UPDATES_URL:-}" ]]; then
  echo "PCOB_UPDATES_URL points a rehearsal build at a local update server; unset it to release." >&2
  exit 64
fi
# Dotenv files are ignored by Git, so they could change the bundle without changing the revision.
export EXPO_NO_DOTENV=1
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

# Keep credentials out of Expo, Metro, CocoaPods, and the unsigned archive environment.
key_id="${ASC_KEY_ID:-}"
issuer_id="${ASC_ISSUER_ID:-}"
key_base64="${ASC_KEY_P8_BASE64:-}"
key_path="${ASC_KEY_PATH:-}"
requested_build="${BUILD_NUMBER:-}"
unset ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_P8_BASE64 ASC_KEY_PATH BUILD_NUMBER
has_key=0
if [[ -n "$key_id$issuer_id$key_base64$key_path" ]]; then
  if [[ -z "$key_id" || -z "$issuer_id" || ( -z "$key_base64" && -z "$key_path" ) ]]; then
    echo "Supply ASC_KEY_ID, ASC_ISSUER_ID, and ASC_KEY_P8_BASE64 or ASC_KEY_PATH together." >&2
    exit 64
  fi
  if [[ -n "$key_base64" && -n "$key_path" ]]; then
    echo "Supply only one of ASC_KEY_P8_BASE64 and ASC_KEY_PATH." >&2
    exit 64
  fi
  if [[ -n "$key_path" && ! -r "$key_path" ]]; then
    echo "ASC_KEY_PATH must point to a readable private key." >&2
    exit 64
  fi
  has_key=1
fi

cli() { (cd "$mobile" && bun run scripts/release/release-cli.ts "$@"); }
# Only these reads see the key; xcodebuild gets it as arguments at export.
asc_cli() {
  if [[ "$has_key" == 1 ]]; then
    ASC_KEY_ID="$key_id" ASC_ISSUER_ID="$issuer_id" ASC_KEY_PATH="$key_path" cli "$@"
  else
    cli "$@"
  fi
}

# Fail before any work if the environment names another analytics key.
analytics_key="$(cli analytics-key)"
unset EXPO_PUBLIC_POSTHOG_KEY POSTHOG_PROJECT_KEY

signing_args=()
if [[ "$has_key" == 1 ]]; then signing_args+=(--has-key); fi
signing=none
export_options=""
if [[ "$destination" == export ]]; then
  signing="$(cli signing ${signing_args[@]+"${signing_args[@]}"})"
  export_options="$(cli export-options ${signing_args[@]+"${signing_args[@]}"})"
fi

key_dir=""
locked=0
cleanup() {
  if [[ -n "$key_dir" ]]; then rm -rf "$key_dir"; fi
  if [[ "$locked" == 1 ]]; then cli lock release --pid $$ || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ -n "$key_base64" ]]; then
  key_dir="$(mktemp -d "${TMPDIR:-/tmp}/pcob-asc.XXXXXX")"
  chmod 700 "$key_dir"
  key_path="$key_dir/AuthKey_${key_id}.p8"
  (umask 077 && printf '%s' "$key_base64" | base64 --decode > "$key_path")
  chmod 600 "$key_path"
  unset key_base64
fi

# One release per machine at a time, so two never take the same build number.
cli lock acquire --pid $$ --revision "$revision"
locked=1
cd "$mobile"

if [[ "$skip_build" == 1 ]]; then
  if [[ ! -d "$archive" || "$(cat "$out/revision" 2>/dev/null)" != "$revision" ]]; then
    echo "No archive exists for this exact revision. Run without --skip-build." >&2
    exit 1
  fi
  build="$(cat "$out/build-number")"
  if [[ -n "$requested_build" && "$requested_build" != "$build" ]]; then
    echo "This archive is build $build; BUILD_NUMBER cannot change it." >&2
    exit 64
  fi
else
  build="$(asc_cli build-number choose --pid $$ --revision "$revision" ${requested_build:+--requested "$requested_build"})"
fi
export BUILD_NUMBER="$build"

if [[ "$skip_build" == 0 ]]; then
  available_kib="$(df -Pk "$mobile" | awk 'NR == 2 { print $4 }')"
  if [[ "$available_kib" -lt 15728640 ]]; then
    echo "A release archive requires at least 15 GiB of free disk space." >&2
    exit 1
  fi
  echo "==> Release Hermes gate (host engine, before archiving)"
  bun run scripts/hermes-gate/gate.ts
  mkdir -p build
  # Generated native source is ignored by Git, so a clean checkout alone cannot
  # prove it matches the revision. Regenerate it for every new release archive.
  CI=1 bunx expo prebuild --clean --no-install --platform ios
  (cd ios && pod install)
  assert_clean
  if command -v ccache >/dev/null 2>&1; then
    CCACHE_BINARY="$(command -v ccache)"
    export CCACHE_BINARY
  fi
  rm -rf "$out"
  mkdir -p "$out/maps/hermes"
  bun run scripts/release/artifact-cli.ts source > "$out/artifact.json"
  echo "==> Archiving pcobooster.com $revision (build $build)"
  EXPO_PUBLIC_POSTHOG_KEY="$analytics_key" \
  EXPO_PUBLIC_SOURCE_REVISION="$revision" \
  SOURCEMAP_FILE="$out/maps/hermes/main.jsbundle.map" \
  COMPOSE_SOURCEMAP_PATH="$mobile/scripts/compose-source-maps.mjs" \
  PCOB_PACKAGER_SOURCEMAP_COPY="$out/maps/packager/main.jsbundle.map" \
  NODE_ENV=production xcodebuild archive \
    -workspace ios/PCOBooster.xcworkspace -scheme PCOBooster -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath build/derived-release \
    -archivePath "$archive" \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CURRENT_PROJECT_VERSION="$build" \
    MODULE_CACHE_DIR="$HOME/Library/Developer/Xcode/DerivedData/ModuleCache.noindex" \
    CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO
  assert_clean
  if [[ "$(git -C "$repo" rev-parse HEAD)" != "$revision" ]]; then
    echo "Source revision changed while archiving; refusing export." >&2
    exit 1
  fi
  bun run scripts/release/artifact-cli.ts record "$out/artifact.json" "$archive/Products/Applications/PCOBooster.app" release-archive-app
  printf '%s\n' "$revision" > "$out/revision"
  printf '%s\n' "$build" > "$out/build-number"
fi

app="$archive/Products/Applications/PCOBooster.app"
bun run scripts/release/artifact-cli.ts verify "$out/artifact.json" "$app" release-archive-app
# Maps and provenance must belong to this exact archived bytecode. They remain alongside the
# archive for a separately authorized source-map upload; prepare/export never sends them.
bun run scripts/source-maps.ts verify --maps "$out/maps" --bundle "$app/main.jsbundle"
info="$app/Info.plist"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info")"
archived_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$info")"
bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info")"
if [[ "$bundle" != com.pcobooster.ios || "$version" != 0.1.0 || "$archived_build" != "$build" ]]; then
  echo "Archive identity, version, or build number does not match this release." >&2
  exit 1
fi
# Hermes keeps string literals verbatim, so an archive built without the key lacks these bytes and
# would ship with analytics and diagnostics off.
if ! LC_ALL=C grep -qF "$analytics_key" "$app/main.jsbundle"; then
  echo "The archived JavaScript does not embed the PostHog project key; analytics and diagnostics would be off. Refusing this archive." >&2
  exit 1
fi
# Over-the-air updates reach a build only through the runtime version it embeds
# (docs/ci-cd.md#ios-updates-over-the-air); an archive without one could never receive them.
runtime_version="$(cat "$app/EXUpdates.bundle/fingerprint" 2>/dev/null || true)"
if [[ ! "$runtime_version" =~ ^[0-9a-f]{40}$ ]]; then
  echo "The archive embeds no update runtime version, so over-the-air updates could never reach it. Refusing this archive." >&2
  exit 1
fi
printf '%s\n' "$runtime_version" > "$out/runtime-version"
echo "==> Update runtime version $runtime_version"
echo "==> Release Hermes gate (host engine, archived bytecode version)"
bun run scripts/hermes-gate/gate.ts --bundle "$app/main.jsbundle"

if [[ "$destination" == prepare ]]; then
  echo "==> Unsigned archive prepared at $archive. No signing or upload attempted."
  exit 0
fi

auth=()
# An explicitly selected installed certificate/profile must not fall back to cloud signing.
if [[ -z "${PCOB_RELEASE_CERTIFICATE_SHA1:-}" ]]; then auth+=(-allowProvisioningUpdates); fi
if [[ "$signing" == api-key ]]; then
  auth+=(-authenticationKeyPath "$key_path" -authenticationKeyID "$key_id" -authenticationKeyIssuerID "$issuer_id")
fi
printf '%s\n' "$export_options" > "$out/ExportOptions.plist"
rm -rf "$out/export"
echo "==> Exporting pcobooster.com $version ($build), destination=$destination, signing=$signing"
# Local export always uses destination=export. Upload is intentionally unavailable.
xcodebuild -exportArchive -archivePath "$archive" \
  -exportOptionsPlist "$out/ExportOptions.plist" -exportPath "$out/export" "${auth[@]}"
echo "==> dSYMs for symbolication: $archive/dSYMs"
echo "==> Signed IPA exported to $out/export"
