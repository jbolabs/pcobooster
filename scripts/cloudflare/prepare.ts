import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

/** Variables the product and marketing builds inline (see their `vite.config.ts`). */
const inlinedVariables = [
  "PLANNING_CENTER_TIME_ZONE",
  "POSTHOG_PROJECT_KEY",
] as const;
const buildStampName = "cloudflare-build-inputs.json";

/**
 * Alchemy's memo hashes files, not the environment: record the stage (which picks the product
 * favicon) and the variables the web build inlines in a gitignored file the product's memo
 * hashes. Source files, including the workspace packages and the marketing site the web build
 * stages, are memo workspaces in `alchemy.run.ts`.
 */
export const prepareCloudflareBuild = async (stage: string): Promise<void> => {
  const publicEnvironment = Object.fromEntries(
    inlinedVariables.map((key) => [key, process.env[key] ?? null])
  );
  const sha256 = createHash("sha256")
    .update(JSON.stringify({ stage, publicEnvironment }))
    .digest("hex");
  const stamp = `${JSON.stringify({ sha256 })}\n`;
  await writeFile(`apps/web/${buildStampName}`, stamp);
};
