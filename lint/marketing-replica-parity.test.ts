import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  planViewFeatures,
  planViews as productPlanViews,
} from "../apps/web/src/lib/app-routes";
import { featureFlags } from "../packages/api/src/config/feature-flags";

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

/** Views everyone sees in production; a view behind a flag that's off there stays unadvertised. */
const releasedPlanViews = productPlanViews.filter((view) => {
  const flag = planViewFeatures[view];
  return flag === undefined || featureFlags[flag].enabled.production;
});

describe("marketing product replica parity", () => {
  it("lists the plan views the product shows everyone in production", () => {
    expect(marketingPlanViewIds()).toEqual(releasedPlanViews);
  });
});
