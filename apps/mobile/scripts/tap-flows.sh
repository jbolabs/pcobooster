#!/usr/bin/env bash
# Runs fixture-only UI flows on one named simulator. Metro must be running on this worktree's port.
#
# Usage: scripts/tap-flows.sh [--simulator <name>] [--suite session|plan|features] [flow ...]
#
# - --simulator picks the simulator by name (default pcob-expo-session); the flows drive only it.
# - --suite session (default) runs the account and services flows; plan runs the run sheet and
#   Times flows, each launched on its plan segment.
# - Naming flows runs just those, from the chosen suite's launch rules.
set -euo pipefail
cd "$(dirname "$0")/.."

simulator=pcob-expo-session
suite=session
flows=()
while [ $# -gt 0 ]; do
  case "$1" in
    --simulator) simulator="$2"; shift ;;
    --suite) suite="$2"; shift ;;
    -*) echo "Unknown option: $1" >&2; exit 64 ;;
    *) flows+=("$1") ;;
  esac
  shift
done
case "$suite" in
  session) defaults=(demo-link switch-account sign-out services-filter account-actions feedback) ;;
  features) defaults=(people-detail songs-library search-navigation) ;;
  plan) defaults=(runsheet-edit runsheet-song runsheet-menus times-edit times-assign times-create plan-content-navigation assign-gestures) ;;
  *) echo "Unknown suite: $suite" >&2; exit 64 ;;
esac
if [ ${#flows[@]} -eq 0 ]; then flows=("${defaults[@]}"); fi

udid="$(xcrun simctl list devices available -j | python3 -c 'import json,sys; name=sys.argv[1]; data=json.load(sys.stdin); matches=[d["udid"] for devices in data["devices"].values() for d in devices if d["name"]==name]; sys.exit(f"Expected exactly one {name} simulator") if len(matches)!=1 else print(matches[0])' "$simulator")"
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
maestro="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
output=".captures/tap-$suite"
mkdir -p "$output"
trap 'xcrun simctl terminate "$udid" com.pcobooster.ios >/dev/null 2>&1 || true' EXIT

# The launch arguments a flow starts from: its session for the session suite, its plan segment
# for the plan suite.
launch_args() {
  local flow="$1"
  if [ "$suite" != plan ]; then
    local state=signedIn
    if [ "$flow" = demo-link ]; then state=signedOut; fi
    echo "-PCOBMockSession $state"
    return
  fi
  local segment=plan
  if [[ "$flow" == times-* ]]; then segment=times; fi
  if [[ "$flow" == assign-* ]]; then segment=assign; fi
  if [ "$flow" = plan-content-navigation ]; then segment=""; fi
  echo "-PCOBRoute /services/1101/plans/881261004/$segment"
}

failed=()
for flow in "${flows[@]}"; do
  xcrun simctl terminate "$udid" com.pcobooster.ios >/dev/null 2>&1 || true
  # shellcheck disable=SC2046
  xcrun simctl launch "$udid" com.pcobooster.ios -PCOBMock YES -PCOBFixedNow YES \
    -PCOBFeatures all -PCOBMockLatency 0 $(launch_args "$flow") >/dev/null
  if "$maestro" --device "$udid" test --test-output-dir "$output/$flow" "flows/$flow.yaml"; then
    echo "PASS $flow"
  else
    echo "FAIL $flow"
    failed+=("$flow")
  fi
done
if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed: ${failed[*]}" >&2
  exit 1
fi
