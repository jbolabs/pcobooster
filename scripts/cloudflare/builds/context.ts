import { trialStage } from "../builds-trial/settings";

export const buildContext = (env: NodeJS.ProcessEnv, checkout: string) => {
  const sha = env.WORKERS_CI_COMMIT_SHA;
  if (
    env.WORKERS_CI !== "1" ||
    sha !== checkout ||
    !/^[a-f0-9]{40}$/u.test(checkout)
  ) {
    throw new Error("Workers Builds checkout identity mismatch");
  }
  if (
    env.WORKERS_CI_BRANCH === "main" ||
    env.CLOUDFLARE_CUSTOM_DOMAINS !== undefined ||
    env.ALCHEMY_STAGE !== undefined ||
    env.PCOBOOSTER_STAGE !== undefined
  ) {
    throw new Error("PR builds refuse main and inherited deployment overrides");
  }
  return { sha: checkout, stage: trialStage(env.WORKERS_CI_BUILD_UUID ?? "") };
};
