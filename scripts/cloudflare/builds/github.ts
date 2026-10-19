import { Schema } from "effect";

export const repository = "jbolabs/pcobooster";
export const pullRequestSchema = Schema.Struct({
  number: Schema.Number,
  state: Schema.String,
  head: Schema.Struct({
    sha: Schema.String,
    ref: Schema.String,
    repo: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
  }),
  base: Schema.Struct({
    sha: Schema.String,
    ref: Schema.String,
    repo: Schema.Struct({ full_name: Schema.String }),
  }),
});
export type PullRequest = typeof pullRequestSchema.Type;
export interface GitHubAccess {
  baseUrl: string;
  token: string;
}
export const runnerGitHubAccess = (env: NodeJS.ProcessEnv): GitHubAccess => {
  const token = env.BUILDS_REPOSITORY_READ_TOKEN;
  if (token === undefined || token === "") {
    throw new Error("Repository read credential unavailable");
  }
  return {
    baseUrl:
      "https://pcobooster-builds-controller.jakebodea.workers.dev/github/",
    token,
  };
};
export const readGitHub = async <A>(
  path: string,
  schema: Schema.Codec<A>,
  access: GitHubAccess
): Promise<A> => {
  const response = await fetch(`${access.baseUrl}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${access.token}`,
      "User-Agent": "pcobooster-cloudflare-builds",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub read failed: ${response.status}`);
  }
  return Schema.decodeUnknownSync(schema)(await response.json());
};
export const currentPullRequest = async (
  number: number,
  access: GitHubAccess
): Promise<PullRequest> =>
  await readGitHub(`pulls/${number}`, pullRequestSchema, access);
export const eligiblePullRequest = (pr: PullRequest, sha: string): boolean =>
  pr.state === "open" &&
  pr.head.repo?.full_name === repository &&
  pr.base.repo.full_name === repository &&
  pr.head.sha === sha;
export const pullRequestForCommit = async (
  sha: string,
  access: GitHubAccess
): Promise<PullRequest> => {
  const prs = await readGitHub(
    `commits/${sha}/pulls`,
    Schema.Array(pullRequestSchema),
    access
  );
  const eligible = prs.filter((pr) => eligiblePullRequest(pr, sha));
  if (eligible.length !== 1) {
    throw new Error(
      "Expected one current same-repository pull request for this commit"
    );
  }
  const [pr] = eligible;
  if (pr === undefined) {
    throw new Error("Pull request unavailable");
  }
  return pr;
};
