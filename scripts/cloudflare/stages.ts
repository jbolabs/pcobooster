const previewStagePattern = /^pr-(?<number>[1-9]\d*)$/u;
const previewResourcePattern =
  /^pcobooster-pr-(?<number>[1-9]\d*)(?:-(?:api|web))?$/u;
const dayMs = 24 * 60 * 60 * 1000;

/** An open pull request's preview is destroyed after this long without a deploy. */
export const previewIdleLimitMs = 3 * dayMs;

/** Pull request stages are the only stages CI may create or destroy without approval. */
export const isPreviewStage = (stage: string): boolean =>
  previewStagePattern.test(stage);

export interface CloudflareResource {
  readonly name: string;
  /** When the Worker was last uploaded or the database was created. */
  readonly changedAt: Date;
}

export interface PreviewStage {
  readonly pullRequest: number;
  /** The most recent change to any resource the stage owns. */
  readonly lastDeployedAt: Date;
}

/** Pull request stages owned by Worker scripts and D1 databases named by `alchemy.run.ts`. */
export const previewStages = (
  resources: readonly CloudflareResource[]
): PreviewStage[] => {
  const latest = new Map<number, Date>();
  for (const { name, changedAt } of resources) {
    const found = previewResourcePattern.exec(name)?.groups?.number;
    if (found === undefined) {
      continue;
    }
    const pullRequest = Number(found);
    const known = latest.get(pullRequest);
    if (known === undefined || changedAt > known) {
      latest.set(pullRequest, changedAt);
    }
  }
  return [...latest]
    .map(([pullRequest, lastDeployedAt]) => ({ pullRequest, lastDeployedAt }))
    .toSorted((a, b) => a.pullRequest - b.pullRequest);
};

export type SweepDecision = "keep" | "destroy-closed" | "destroy-idle";

/**
 * Closed pull requests lose their stage. Open ones keep it until it sits idle past the limit;
 * the next push redeploys it.
 */
export const sweepDecision = (
  stage: PreviewStage,
  pullRequestOpen: boolean,
  now: Date
): SweepDecision => {
  if (!pullRequestOpen) {
    return "destroy-closed";
  }
  return now.getTime() - stage.lastDeployedAt.getTime() > previewIdleLimitMs
    ? "destroy-idle"
    : "keep";
};
