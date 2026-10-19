import type { FeatureAccess } from "@pcobooster/planning-center-models/access";
import { describe, expect, it } from "vitest";

import {
  accessFingerprint,
  parseAccessReviewDismissals,
  planAccessMessage,
  recordAccessReviewDismissal,
  shouldPromptAccessReview,
  visibleFeatureAccess,
} from "@/lib/planning-center-access";

const entry = (
  feature: FeatureAccess["feature"],
  availability: FeatureAccess["availability"]
): FeatureAccess => ({
  feature,
  label: feature,
  availability,
  detail: "",
  ask: null,
});

const limited = [
  entry("plans", "full"),
  entry("scheduling", "limited"),
  entry("songs", "none"),
];

describe(visibleFeatureAccess, () => {
  it("leaves out flagged features this visitor's flags hide", () => {
    expect(
      visibleFeatureAccess(limited, {
        people: true,
        chordCharts: false,
        practice: false,
      }).map((item) => item.feature)
    ).toStrictEqual(["plans", "scheduling"]);
    expect(
      visibleFeatureAccess(limited, {
        people: false,
        chordCharts: true,
        practice: false,
      }).map((item) => item.feature)
    ).toStrictEqual(["plans", "scheduling", "songs"]);
  });

  it("hides every flagged feature until the flags answer", () => {
    expect(
      visibleFeatureAccess(limited).map((item) => item.feature)
    ).toStrictEqual(["plans", "scheduling"]);
  });
});

describe(shouldPromptAccessReview, () => {
  it("never prompts when everything is available", () => {
    expect(
      shouldPromptAccessReview({
        features: [entry("plans", "full")],
        accountId: "account-1",
        dismissalsRaw: null,
      })
    ).toBeFalsy();
  });

  it("prompts until the account dismisses this exact access", () => {
    const dismissed = recordAccessReviewDismissal(
      null,
      "account-1",
      accessFingerprint(limited)
    );

    expect(
      shouldPromptAccessReview({
        features: limited,
        accountId: "account-1",
        dismissalsRaw: null,
      })
    ).toBeTruthy();
    expect(
      shouldPromptAccessReview({
        features: limited,
        accountId: "account-1",
        dismissalsRaw: dismissed,
      })
    ).toBeFalsy();
    expect(
      shouldPromptAccessReview({
        features: limited,
        accountId: "account-2",
        dismissalsRaw: dismissed,
      })
    ).toBeTruthy();
  });

  it("prompts again when the account's access changes", () => {
    const dismissed = recordAccessReviewDismissal(
      null,
      "account-1",
      accessFingerprint(limited)
    );

    expect(
      shouldPromptAccessReview({
        features: [entry("plans", "full"), entry("scheduling", "none")],
        accountId: "account-1",
        dismissalsRaw: dismissed,
      })
    ).toBeTruthy();
  });
});

describe(parseAccessReviewDismissals, () => {
  it("ignores unreadable storage", () => {
    expect(parseAccessReviewDismissals("{not json")).toStrictEqual({});
    expect(parseAccessReviewDismissals('{"a":1}')).toStrictEqual({});
  });
});

describe(planAccessMessage, () => {
  const viewer = {
    level: "Viewer" as const,
    scheduleAllTeams: false,
    scheduleLedTeams: false,
    editPlans: false,
  };
  const scheduler = {
    ...viewer,
    level: "Scheduler" as const,
    scheduleLedTeams: true,
  };
  const editor = {
    level: "Editor" as const,
    scheduleAllTeams: true,
    scheduleLedTeams: true,
    editPlans: true,
  };

  it("holds nothing back from an Editor", () => {
    expect(planAccessMessage("assign", editor)).toBeNull();
    expect(planAccessMessage("plan", editor)).toBeNull();
    expect(planAccessMessage("times", editor)).toBeNull();
  });

  it("tells a Viewer that scheduling and editing are view only", () => {
    expect(planAccessMessage("assign", viewer)).toStrictEqual({
      title: "View only",
      description:
        "Your Planning Center access here is Viewer. Scheduling needs Scheduler (for teams you lead) or Editor.",
    });
    expect(planAccessMessage("plan", viewer)?.title).toBe("View only");
  });

  it("tells a Scheduler they can schedule only teams they lead", () => {
    expect(planAccessMessage("assign", scheduler)?.title).toBe(
      "You can schedule only the teams you lead"
    );
  });

  it("lets a Scheduler add rehearsal times but not service times", () => {
    expect(planAccessMessage("times", scheduler)?.title).toBe(
      "Service times need Editor"
    );
    expect(planAccessMessage("times", viewer)?.title).toBe("View only");
  });

  it("stays quiet on views that change nothing", () => {
    expect(planAccessMessage("overview", viewer)).toBeNull();
    expect(planAccessMessage("lineup", viewer)).toBeNull();
  });
});
