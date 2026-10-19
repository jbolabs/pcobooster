import { execFileSync } from "node:child_process";

import { run } from "./validate";

export const validateRelease = (): void => {
  const shallow =
    execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      encoding: "utf-8",
    }).trim() === "true";
  execFileSync(
    "git",
    [
      "fetch",
      ...(shallow ? ["--unshallow"] : []),
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ],
    { stdio: "inherit" }
  );
  const secretless = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:CLOUDFLARE_|BUILDS_|STAGING_ACCESS_|POSTHOG_ANNOTATION|GITHUB_TOKEN|PCOBOOSTER_ADMIN_)/u.test(
          key
        )
    )
  );
  const validation = { ...secretless, TURBO_FORCE: "true" };
  run(["run", "check"], validation);
  run(["run", "typecheck", "--concurrency=1"], validation);
  run(["run", "test:install"], validation);
  run(
    ["turbo", "run", "test", "//#test:root", "--concurrency=1", "--force"],
    validation
  );
  run(["run", "build:cloudflare"], {
    ...secretless,
    TURBO_FORCE: "true",
    TURBO_CACHE: "local:rw",
  });
};
if (import.meta.main) {
  validateRelease();
}
