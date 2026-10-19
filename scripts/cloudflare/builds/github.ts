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
export const readGitHub = async <A>(
  path: string,
  schema: Schema.Codec<A>
): Promise<A> => {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "pcobooster-cloudflare-builds",
      },
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub read failed: ${response.status}`);
  }
  return Schema.decodeUnknownSync(schema)(await response.json());
};
export const currentPullRequest = async (
  number: number
): Promise<PullRequest> =>
  await readGitHub(`pulls/${number}`, pullRequestSchema);
export const eligiblePullRequest = (pr: PullRequest, sha: string): boolean =>
  pr.state === "open" &&
  pr.head.repo?.full_name === repository &&
  pr.base.repo.full_name === repository &&
  pr.head.sha === sha;
export const pullRequestForCommit = async (
  sha: string
): Promise<PullRequest> => {
  const prs = await readGitHub(
    `commits/${sha}/pulls`,
    Schema.Array(pullRequestSchema)
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
