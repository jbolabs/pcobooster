import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planViews as productPlanViews } from "../apps/web/src/lib/app-routes";

const repositoryRoot = join(import.meta.dirname, "..");
const marketingDemoPath = join(
  repositoryRoot,
  "apps/marketing/src/components/product-demo/product-demo.tsx"
);

const marketingPlanViewIds = (): string[] => {
  const contents = readFileSync(marketingDemoPath, "utf8");
  const ids: string[] = [];
  const pattern = /\{\s*id:\s*"(overview|assign|lineup|plan|times|practice)"/gu;
  for (const match of contents.matchAll(pattern)) {
    const id = match[1];
    if (id !== undefined) {
      ids.push(id);
    }
  }
  return ids;
};

describe("marketing product replica parity", () => {
  it("lists the same plan views as the product shell", () => {
    expect(marketingPlanViewIds()).toEqual([...productPlanViews]);
  });
});
