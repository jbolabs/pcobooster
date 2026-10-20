#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

cd "$REPOSITORY_ROOT"
codex_cloud_bootstrap
LEFTHOOK=0 bun install --frozen-lockfile
# With the agent-dev identity in the host secrets, store it in the default Alchemy profile so
# stage `local` reads Infisical pcobooster-dev. Values come from the environment, not arguments.
if [[ -n "${INFISICAL_CLIENT_ID:-}" && -n "${INFISICAL_CLIENT_SECRET:-}" ]]; then
  bun run setup:infisical
fi

printf 'Codex cloud setup complete.\n'
