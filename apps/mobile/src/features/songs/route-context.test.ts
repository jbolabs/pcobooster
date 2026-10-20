import { describe, expect, it } from "vitest";

import { planHref, routeSegment } from "../plan/reads";
import { songPathInPlan } from "./route-context";

describe("plan preparation navigation", () => {
  it("opens the order by default and gives Times a direct destination", () => {
    expect(routeSegment()).toBe("Plan");
    expect(planHref({ serviceTypeId: "10", planId: "20" }, "Times")).toBe(
      "/services/10/plans/20/times"
    );
    expect(routeSegment("times")).toBe("Times");
    expect(routeSegment("files")).toBe("Files");
  });

  it("keeps song preparation in the plan stack, including arrangement and key", () => {
    expect(
      songPathInPlan("/songs/30/chart?arrangement=40&target=key-50", {
        serviceTypeId: "10",
        planId: "20",
      })
    ).toBe("/services/10/plans/20/songs/30/chart?arrangement=40&target=key-50");
    expect(songPathInPlan("/songs/30/files")).toBe("/songs/30/files");
  });
});
