import * as Infisical from "@alchemy.run/infisical";

/**
 * The only place that names the Infisical projects or maps stages to them. On the free plan a
 * project is the access boundary (no environment-scoped roles): `agent-dev` reads only
 * `pcobooster-dev`; `operator` and `ci-prod` read `pcobooster-prod`.
 */
export const infisical = {
  dev: "0d496fd4-544e-448a-b685-978847676ec0",
  prod: "a27bbce0-b9f7-41b3-a7a0-c5ae9e004a2f",
} as const;

const isPullRequestStage = (stage: string) => stage.startsWith("pr-");

/**
 * Which Infisical project and environment a stage reads. `prod` maps to `pcobooster-prod` env
 * `prod`; the central secrets stack's `preview` tier and main-deployed `staging` (which consumes that
 * tier) to env `preview`. Every other stage maps to `pcobooster-dev`, so a pull request stage can
 * never select deployed values.
 */
export const infisicalSource = (stage: string): Infisical.InfisicalOptions => {
  if (stage === "prod") {
    return { project: infisical.prod, environment: "prod" };
  }
  if (stage === "preview" || stage === "staging") {
    return { project: infisical.prod, environment: "preview" };
  }
  return { project: infisical.dev, environment: "dev" };
};

/**
 * A stack's `secrets` option: Infisical for the listed stages, then the shell (Alchemy closes every
 * list with the process environment, which wins). Other stages, and every `pr-*` stage even when
 * listed, read the shell alone, so pull request jobs never need or get an Infisical identity.
 */
export const stageSecrets =
  (stages: readonly string[]) =>
  ({ stage }: { readonly stage: string }) =>
    stages.includes(stage) && !isPullRequestStage(stage)
      ? [Infisical.Secrets(infisicalSource(stage))]
      : [];
