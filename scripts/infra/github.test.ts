import * as GitHub from "@alchemy.run/github";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { fakeHttp } from "./fake-http";
import liveRulesetFixture from "./fixtures/live-main-ruleset.json" with { type: "json" };
import {
  convergeRuleset,
  covers,
  RulesetReply,
  rulesetMatches,
  toObservedRuleset,
} from "./github";
import type { RulesetRule } from "./github";
import { mainRuleset } from "./main-ruleset";

const asJson = Schema.decodeUnknownSync(Schema.Json);
const liveRuleset = asJson(liveRulesetFixture);

const observedLive = toObservedRuleset(
  Schema.decodeUnknownSync(RulesetReply)(liveRulesetFixture)
);

const withRules = (rules: readonly RulesetRule[]) => ({
  ...observedLive,
  rules,
});

describe(rulesetMatches, () => {
  it("accepts the live ruleset as-is, so adopting it writes nothing", () => {
    expect(rulesetMatches(mainRuleset, observedLive)).toBeTruthy();
  });

  it("flags a missing required status check rule", () => {
    expect(
      rulesetMatches(
        mainRuleset,
        withRules(
          observedLive.rules.filter(
            (rule) => rule.type !== "required_status_checks"
          )
        )
      )
    ).toBeFalsy();
  });

  it("flags an extra live rule", () => {
    expect(
      rulesetMatches(
        mainRuleset,
        withRules([...observedLive.rules, { type: "required_signatures" }])
      )
    ).toBeFalsy();
  });

  it("flags a bypass actor", () => {
    expect(
      rulesetMatches(mainRuleset, {
        ...observedLive,
        bypass_actors: [
          { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
        ],
      })
    ).toBeFalsy();
  });

  it("flags a merge method other than squash", () => {
    const rules = observedLive.rules.map((rule) =>
      rule.type === "pull_request"
        ? {
            ...rule,
            parameters: {
              ...rule.parameters,
              allowed_merge_methods: ["squash", "rebase"],
            },
          }
        : rule
    );
    expect(rulesetMatches(mainRuleset, withRules(rules))).toBeFalsy();
  });
});

describe(covers, () => {
  it("ignores parameters GitHub adds with defaults", () => {
    expect(covers({ a: 1 }, { a: 1, added: false })).toBeTruthy();
  });

  it("matches array members in any order", () => {
    expect(
      covers(
        [{ context: "ci" }, { context: "cloudflare-build" }],
        [{ context: "cloudflare-build" }, { context: "ci" }]
      )
    ).toBeTruthy();
  });

  it("requires the same number of array members", () => {
    expect(covers(["ci"], ["ci", "ci"])).toBeFalsy();
  });
});

describe(convergeRuleset, () => {
  const props = {
    owner: "jbolabs",
    repository: "pcobooster",
    ...mainRuleset,
  };
  const summaries = [
    {
      id: 13_589_390,
      name: "Protect main via pull requests",
      source_type: "Repository",
    },
  ];

  const run = async (replies: Parameters<typeof fakeHttp>[0]) => {
    const http = fakeHttp(replies);
    const exit = await Effect.runPromiseExit(
      convergeRuleset(props).pipe(
        Effect.provide(
          Layer.mergeAll(http.layer, GitHub.fromToken("github-token"))
        )
      )
    );
    return { exit, requests: http.requests };
  };

  it("adopts the same-named ruleset without writing when it already matches", async () => {
    const { exit, requests } = await run([
      { status: 200, body: summaries },
      { status: 200, body: liveRuleset },
    ]);

    expect(exit._tag).toBe("Success");
    expect(requests.map(({ method, url }) => [method, url])).toStrictEqual([
      [
        "GET",
        "https://api.github.com/repos/jbolabs/pcobooster/rulesets?includes_parents=false&per_page=100",
      ],
      [
        "GET",
        "https://api.github.com/repos/jbolabs/pcobooster/rulesets/13589390",
      ],
    ]);
    expect(requests[0]?.authorization).toBe("Bearer github-token");
  });

  it("updates the adopted ruleset in place instead of creating another", async () => {
    const drifted = {
      ...liveRulesetFixture,
      rules: liveRulesetFixture.rules.filter(
        (rule) => rule.type !== "required_status_checks"
      ),
    };
    const { requests } = await run([
      { status: 200, body: summaries },
      { status: 200, body: asJson(drifted) },
      { status: 200, body: liveRuleset },
    ]);

    expect(requests[2]?.method).toBe("PUT");
    expect(requests[2]?.url).toBe(
      "https://api.github.com/repos/jbolabs/pcobooster/rulesets/13589390"
    );
    expect(requests[2]?.body).toStrictEqual(mainRuleset);
  });

  it("creates the ruleset only when none has its name", async () => {
    const { requests } = await run([
      { status: 200, body: [] },
      { status: 200, body: liveRuleset },
    ]);

    expect(requests.map(({ method }) => method)).toStrictEqual(["GET", "POST"]);
  });
});
