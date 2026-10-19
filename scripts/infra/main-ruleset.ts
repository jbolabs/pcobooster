/**
 * Desired main protection after the Cloudflare Builds cutover. Apply only after hosted acceptance.
 */
import type { RulesetSpec } from "./github";

/** Verified native Cloudflare Workers and Pages GitHub app. */
const cloudflareAppId = 85_455;

export const mainRuleset: RulesetSpec = {
  name: "Protect main via pull requests",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
  bypass_actors: [],
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_linear_history" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        required_reviewers: [],
        require_code_owner_review: false,
        dismissal_restriction: { enabled: false, allowed_actors: [] },
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        // GitHub reports this but its REST schema omits it; declared so an update keeps it.
        require_extra_approval_for_unattributed_changes: true,
        allowed_merge_methods: ["squash"],
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: [
          {
            context: "Workers Builds: pcobooster-pr-validation",
            integration_id: cloudflareAppId,
          },
        ],
      },
    },
  ],
};
