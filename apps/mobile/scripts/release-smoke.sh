#!/usr/bin/env bash
# Cold-launches a Release smoke build on an idle shared simulator and records whether each startup
# path reaches its first screen without a fatal JS or native error.
#
# Usage: scripts/release-smoke.sh [--build] [--simulator <name>] [--allow-dirty]
#
# - --build makes the smoke app: a Release simulator build (Hermes bytecode, no Metro) with
#   EXPO_PUBLIC_PCOB_RELEASE_SMOKE=1, so every request is answered by the fixtures or fails as a
#   lost connection, while the Keychain, app storage, and cache restoration stay real
#   (src/harness/release-smoke.ts). Without --build, the last smoke app is reused only if it was
#   built from this exact revision.
# - --simulator selects an existing Shutdown shared simulator (agent-sim-1/2/3 or
#   agent-sim-ipad). Otherwise the first idle shared simulator is selected. Only this app is
#   uninstalled; the simulator is never erased. Cleanup shuts down the simulator we booted.
# - Paths, in order: fresh-install (signed out, fixtures), signed-out-offline, sign-in (fixture
#   sign-in saved to the Keychain), restored-session, restored-offline.
# - Evidence (manifest.json, per-path logs and screenshots) lands in
#   .captures/release-smoke/<revision>. It is simulator evidence for a Release-configuration
#   smoke build; it is not the signed TestFlight binary, a physical device, or live data.
# - Needs Maestro and OpenJDK 17, as scripts/tap-flows.sh does. No Planning Center or production
#   API request is made, and nothing is uploaded.
set -euo pipefail
cd "$(dirname "$0")/.."
mobile="$PWD"
repo="$(cd ../.. && pwd)"

build=0
simulator=""
allow_dirty=0
while [ $# -gt 0 ]; do
  case "$1" in
    --build) build=1 ;;
    --simulator) simulator="$2"; shift ;;
    --allow-dirty) allow_dirty=1 ;;
    *) echo "Unknown option: $1" >&2; exit 64 ;;
  esac
  shift
done

dirty=false
if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=all)" ]]; then
  if [[ "$allow_dirty" == 0 ]]; then
    echo "Smoke evidence is bound to a revision; commit first or pass --allow-dirty." >&2
    exit 1
  fi
  dirty=true
fi
revision="$(git -C "$repo" rev-parse HEAD)"

selection="$(xcrun simctl list devices available -j | python3 -I scripts/simulator/select_shared.py "$simulator")"
IFS=$'\t' read -r simulator udid <<< "$selection"
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
maestro="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
if [[ ! -x "$maestro" ]]; then
  echo "Maestro is not installed at $maestro (set MAESTRO_BIN)." >&2
  exit 1
fi

app="build/derived/Build/Products/Release-iphonesimulator/PCOBooster.app"
stamp="build/release-smoke/build.json"
if [[ "$build" == 1 ]]; then
  mkdir -p build/release-smoke
  rm -f "$stamp"
  bun run scripts/release/artifact-cli.ts source > "$stamp"
  # The smoke flag is the only difference from a Release build. Analytics stays off (no key),
  # and dotenv files cannot add anything the revision does not hold.
  env -u EXPO_PUBLIC_POSTHOG_KEY -u POSTHOG_PROJECT_KEY \
    EXPO_PUBLIC_PCOB_RELEASE_SMOKE=1 EXPO_NO_DOTENV=1 NODE_ENV=production \
    bash scripts/build-ios.sh --configuration Release --udid "$udid" --no-debug-symbols
  bun run scripts/release/artifact-cli.ts record "$stamp" "$app" release-smoke-app
fi
if [[ ! -f "$stamp" || ! -f "$app/main.jsbundle" ]]; then
  echo "No smoke app; run with --build." >&2
  exit 1
fi
bundle_sha="$(shasum -a 256 "$app/main.jsbundle" | cut -d' ' -f1)"
bun run scripts/release/artifact-cli.ts verify "$stamp" "$app" release-smoke-app
bytecode="$(python3 -I -c 'import struct,sys; b=open(sys.argv[1],"rb").read(12); print(struct.unpack("<I", b[8:12])[0] if struct.unpack("<Q", b[:8])[0] == 0x1F1903C103BC1FC6 else "none")' "$app/main.jsbundle")"
if [[ "$bytecode" == none ]]; then
  echo "$app/main.jsbundle is not Hermes bytecode; this is not a Release build." >&2
  exit 1
fi

suffix=""
if [[ "$dirty" == true ]]; then suffix=-dirty; fi
out="$mobile/.captures/release-smoke/$revision$suffix"
rm -rf "$out"
mkdir -p "$out"
results="$out/results.tsv"
: > "$results"

terminate() { xcrun simctl terminate "$udid" com.pcobooster.ios >/dev/null 2>&1 || true; }
log_pid=""
stop_log() {
  if [ -n "$log_pid" ]; then kill "$log_pid" 2>/dev/null || true; wait "$log_pid" 2>/dev/null || true; log_pid=""; fi
}
booted_here=0
cleanup() {
  local status=$?
  stop_log
  if [[ "$booted_here" == 1 ]]; then
    terminate
    if ! xcrun simctl shutdown "$udid"; then
      echo "Could not shut down shared simulator $simulator ($udid)." >&2
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
  fi
  return "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# A build may take minutes: refuse if another task has since booted this device.
xcrun simctl list devices available -j | python3 -I scripts/simulator/select_shared.py "$simulator" >/dev/null
xcrun simctl boot "$udid"
booted_here=1
xcrun simctl bootstatus "$udid" -b >/dev/null
# Uninstall removes only our container. The first-install marker then makes the app delete
# its own surviving Keychain session before loading it (clearIfFreshInstall).
if xcrun simctl get_app_container "$udid" com.pcobooster.ios app >/dev/null 2>&1; then
  xcrun simctl uninstall "$udid" com.pcobooster.ios
fi
xcrun simctl install "$udid" "$app"

fatal_pattern='Unhandled JS Exception|RCTFatal|Terminating app due to uncaught exception|EXC_BAD_ACCESS|EXC_CRASH|Fatal error:'

# run_path <name> <network> <flow>
run_path() {
  local name="$1" network="$2" flow="$3" dir="$out/$1" status=PASS reason=""
  mkdir -p "$dir"
  touch "$dir/.started"
  terminate
  xcrun simctl spawn "$udid" log stream --style compact --level debug \
    --predicate 'process == "PCOBooster"' > "$dir/device.log" 2>&1 &
  log_pid=$!
  sleep 1
  xcrun simctl launch "$udid" com.pcobooster.ios -PCOBSmoke "$network" > "$dir/launch.txt"
  if ! "$maestro" --device "$udid" test --test-output-dir "$dir/maestro" "flows/smoke/$flow.yaml" > "$dir/maestro.txt" 2>&1; then
    status=FAIL; reason="the first screen did not appear (flows/smoke/$flow.yaml)"
  fi
  # Let late startup work (cache persistence, deferred reads) run before judging the process.
  sleep 3
  xcrun simctl io "$udid" screenshot "$dir/final.png" >/dev/null 2>&1 || true
  if ! xcrun simctl spawn "$udid" launchctl list | awk '/UIKitApplication:com\.pcobooster\.ios/ { if ($1 != "-") found = 1 } END { exit !found }'; then
    status=FAIL; reason="${reason:+$reason; }the app is no longer running"
  fi
  stop_log
  if grep -Eq "$fatal_pattern" "$dir/device.log"; then
    status=FAIL; reason="${reason:+$reason; }a fatal error is in device.log"
  fi
  local crash
  crash="$(find "$HOME/Library/Logs/DiagnosticReports" -name 'PCOBooster*' -newer "$dir/.started" 2>/dev/null | head -1 || true)"
  if [[ -n "$crash" ]]; then
    cp "$crash" "$dir/"
    status=FAIL; reason="${reason:+$reason; }crash report $(basename "$crash")"
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$network" "$status" "$reason" >> "$results"
  echo "$status $name ($network)${reason:+: $reason}"
}

run_path fresh-install online signed-out
run_path signed-out-offline offline signed-out
run_path sign-in online sign-in
run_path restored-session online signed-in
run_path restored-offline offline signed-in
terminate

runtime="$(xcrun simctl list devices -j | python3 -I -c 'import json,sys; u=sys.argv[1]; d=json.load(sys.stdin)["devices"]; print(next(k for k,v in d.items() for x in v if x["udid"]==u))' "$udid")"
python3 -I - "$out" "$results" "$stamp" <<PY
import json, sys
out, results, stamp_file = sys.argv[1:]
stamp = json.load(open(stamp_file))
paths = []
for line in open(results):
    name, network, status, reason = line.rstrip("\n").split("\t")
    paths.append({"name": name, "network": network, "status": status, "reason": reason or None,
                  "evidence": name})
manifest = {
    "kind": "simulator-release-smoke",
    "limits": "Release configuration (Hermes bytecode, no Metro) on the iOS Simulator, built with EXPO_PUBLIC_PCOB_RELEASE_SMOKE=1: fixture or failing network, real Keychain, app storage, and cache restoration. Not the signed TestFlight binary, a physical device, OAuth, or live data.",
    "revision": "$revision",
    "dirty": "$dirty" == "true",
    "buildStamp": stamp,
    "app": {
        "path": "$app",
        "bundleId": "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")",
        "version": "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Info.plist")",
        "build": "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Info.plist")",
        "mainJsbundleSha256": "$bundle_sha",
        "appSha256": stamp["appSha256"],
        "hermesBytecodeVersion": int("$bytecode"),
    },
    "simulator": {"name": "$simulator", "udid": "$udid", "runtime": "$runtime"},
    "xcode": "$(xcodebuild -version | tr '\n' ' ' | sed 's/ $//')",
    "paths": paths,
    "status": "PASS" if all(p["status"] == "PASS" for p in paths) else "FAIL",
}
json.dump(manifest, open(f"{out}/manifest.json", "w"), indent=2)
print(f"==> Evidence: {out}/manifest.json ({manifest['status']})")
sys.exit(0 if manifest["status"] == "PASS" else 1)
PY
bun run scripts/release/artifact-cli.ts seal-evidence "$out"
bun run scripts/release/artifact-cli.ts verify-evidence "$out" "$app"
