export const trialBranch = "codex/cloudflare-builds-trial";
export const trialWorker = "pcobooster-builds-trial-runner";
export const trialControlStage = "builds-trial-control";
export const trialStagePattern = /^builds-trial-[a-f0-9]{12}$/u;

/** Each hosted build gets its own resources, including interrupted builds. */
export const trialStage = (buildId: string): string => {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
      buildId
    )
  ) {
    throw new Error("Expected a Cloudflare build UUID");
  }
  return `builds-trial-${buildId.replaceAll("-", "").slice(0, 12)}`;
};

export const trialContext = (env: NodeJS.ProcessEnv, checkout: string) => {
  if (env.WORKERS_CI !== "1" || env.WORKERS_CI_BRANCH !== trialBranch) {
    throw new Error(
      "This command only runs in Workers Builds on the trial branch"
    );
  }
  const sha = env.WORKERS_CI_COMMIT_SHA;
  if (sha === undefined || !/^[a-f0-9]{40}$/u.test(sha) || sha !== checkout) {
    throw new Error("Build revision does not match the checkout");
  }
  if (
    env.CLOUDFLARE_CUSTOM_DOMAINS !== undefined ||
    env.ALCHEMY_STAGE !== undefined ||
    env.PCOBOOSTER_STAGE !== undefined
  ) {
    throw new Error("Trial refuses inherited domain or stage overrides");
  }
  return { sha, stage: trialStage(env.WORKERS_CI_BUILD_UUID ?? "") };
};
