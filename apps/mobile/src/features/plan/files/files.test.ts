import { makeProductClient } from "@pcobooster/client/product-client";
import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { createOptimisticBasicPlanItem } from "@pcobooster/planning-center-models/plan-item-order";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { makeFixtureFetch } from "../../../harness/fixture-transport";
import type { PreviewFiles } from "../../songs/previews";
import { groupPlanFiles, planFileKind } from "./model";
import { planFileRead, planFilesRead } from "./reads";

const ids = { serviceTypeId: "1101", planId: "881261004" };
const file = (id: string, overrides: Partial<PlanFile> = {}): PlanFile => ({
  id,
  name: id,
  filename: `${id}.pdf`,
  contentType: "application/pdf",
  fileType: "pdf",
  providerType: "Attachment",
  size: 100,
  hasPreview: true,
  downloadable: true,
  streamable: false,
  ownerType: "Plan",
  ownerId: ids.planId,
  ...overrides,
});
const context = () => ({
  scope: "account-a",
  client: makeProductClient({
    url: "https://fixtures.invalid",
    client: "expo",
    fetch: makeFixtureFetch({ latencyMs: 0 }),
  }),
});

describe("native plan preparation", () => {
  it("loads subsequent file pages without losing the first page", async () => {
    const observer = new InfiniteQueryObserver(
      new QueryClient(),
      planFilesRead(context(), ids)
    );
    await observer.refetch();
    const result = await observer.fetchNextPage();
    expect(
      result.data?.pages.flatMap((page) =>
        page.files.map((entry) => entry.name)
      )
    ).toStrictEqual([
      "Sunday team guide",
      "Morning Light - G",
      "Morning Light - recording",
      "Stage plot",
    ]);
    expect(result.hasNextPage).toBeFalsy();
    observer.destroy();
  });

  it("keeps two identically titled items separate and plan files first", () => {
    const first = {
      ...createOptimisticBasicPlanItem("first", "item", 1),
      title: "Prayer",
    };
    const second = {
      ...createOptimisticBasicPlanItem("second", "item", 2),
      title: "Prayer",
    };
    const groups = groupPlanFiles(
      [
        file("closing-note", { ownerType: "Item", ownerId: "second" }),
        file("team-guide"),
        file("opening-note", { ownerType: "Item", ownerId: "first" }),
      ],
      [first, second]
    );
    expect(
      groups.map((group) => [group.id, group.files.map((entry) => entry.id)])
    ).toStrictEqual([
      ["plan", ["team-guide"]],
      ["first", ["opening-note"]],
      ["second", ["closing-note"]],
    ]);
  });

  it("recognizes generated charts without a PDF filename", () => {
    expect(
      planFileKind(
        file("chart", {
          filename: "",
          contentType: "",
          providerType: "AttachmentChart::Chord",
        })
      )
    ).toBe("pdf");
    expect(
      planFileKind(
        file("recording", { filename: "Rehearsal.M4A", contentType: "" })
      )
    ).toBe("audio");
  });

  it("writes actual PDF bytes to account-scoped storage rather than retaining the signed link", async () => {
    const saved = new Map<string, string>();
    const files: PreviewFiles = {
      exists: (uri) => saved.has(uri),
      begin: (scope) => ({
        writeBase64: (folder, name, bytes) => {
          const uri = `file:///${scope}/${folder}/${name}`;
          saved.set(uri, bytes);
          return uri;
        },
        download: () => {
          throw new Error("PDF should use returned bytes");
        },
        playable: () => {
          throw new Error("PDF should not stream");
        },
      }),
    };
    const answer = await new QueryClient().query(
      planFileRead(context(), files, ids, file("plan-guide"))
    );
    expect(answer.uri).toContain("file:///account-a/plan-");
    expect(atob(saved.get(answer.uri) ?? "").slice(0, 4)).toBe("%PDF");
    expect(answer.name).toBe("plan-guide.pdf");
  });
});
