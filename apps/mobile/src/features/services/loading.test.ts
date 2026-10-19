import { describe, expect, it } from "vitest";

import { selectedLoading, selectedQueries } from "./loading";

const serviceTypes = [{ id: "sunday" }, { id: "seasonal" }];
const selected = new Set(["sunday", "seasonal"]);
const pending = { isPending: true, isError: false };
const loaded = { isPending: false, isError: false };

describe("selected agenda reads", () => {
  it("finishes recent loading when a service type has no upcoming anchor", () => {
    expect(
      selectedLoading(
        serviceTypes,
        selected,
        [loaded, pending],
        ["plan", undefined]
      )
    ).toBeFalsy();
  });

  it("waits for an enabled recent read even beside a disabled one", () => {
    expect(
      selectedLoading(
        serviceTypes,
        selected,
        [pending, pending],
        ["plan", undefined]
      )
    ).toBeTruthy();
  });

  it("waits for upcoming plans before an anchor can be determined", () => {
    expect(
      selectedLoading(serviceTypes, selected, [loaded, pending])
    ).toBeTruthy();
  });

  it("refreshes only selected reads with usable plan anchors", () => {
    expect(
      selectedQueries(
        [...serviceTypes, { id: "unselected" }],
        selected,
        ["sunday-read", "empty-plan-id-read", "unselected-read"],
        ["plan", undefined, "other-plan"]
      )
    ).toStrictEqual(["sunday-read"]);
  });
});
