import { describe, expect, it } from "vitest";

import { maintenancePhases } from "./maintenance-phases";

describe("independent maintenance reports", () => {
  it("reports production drift even if cleanup and staging drift both fail", async () => {
    await expect(
      maintenancePhases([
        {
          name: "cleanup",
          run: async () => {
            await Promise.reject(new Error("cleanup denied"));
          },
        },
        {
          name: "staging",
          run: async () => {
            await Promise.reject(new Error("staging changed"));
          },
        },
        {
          name: "production",
          run: async () => {
            await Promise.reject(new Error("production changed"));
          },
        },
      ])
    ).rejects.toMatchObject({
      errors: [
        { message: "Maintenance failed: cleanup" },
        { message: "Maintenance failed: staging" },
        { message: "Maintenance failed: production" },
      ],
    });
  });
});
