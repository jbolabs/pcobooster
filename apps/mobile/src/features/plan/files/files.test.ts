import { makeProductClient } from "@pcobooster/client/product-client";
import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import {
  PLAN_FILE_SAMPLES,
  planFileSample,
} from "@pcobooster/contracts/http/plan-files.fixture";
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
        file("recording", {
          filename: "Rehearsal.M4A",
          contentType: "",
          fileType: "audio",
        })
      )
    ).toBe("audio");
  });

  it("classifies every attachment combination Planning Center returns", () => {
    expect(
      Object.fromEntries(
        PLAN_FILE_SAMPLES.map(({ label, file: sample }) => [
          label,
          planFileKind(sample),
        ])
      )
    ).toStrictEqual({
      "generated chord chart": "pdf",
      "generated lyrics": "pdf",
      "generated number chart": "pdf",
      "generated numeral chart": "pdf",
      "ChartPro chord chart": "pdf",
      "ChartPro lyrics": "pdf",
      "PraiseCharts chart": "pdf",
      "uploaded PDF": "pdf",
      "uploaded PDF without a type": "unknown",
      "uploaded archive without a type": "unknown",
      "uploaded Word 97 document": "document",
      "uploaded Word document": "document",
      "uploaded zip": "link",
      "uploaded mp3": "audio",
      "uploaded m4a": "audio",
      "uploaded wav": "audio",
      "uploaded 3gp video": "video",
      "uploaded mp4 video": "video",
      "rehearsal mix": "audio",
      "web link": "link",
      "YouTube video": "link",
      "Spotify track": "link",
    });
  });

  it("shows a file without a type as a PDF when its bytes are one, else as a link", async () => {
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
          throw new Error("A file without a type is never downloaded whole");
        },
        playable: () => {
          throw new Error("A file without a type never streams");
        },
      }),
    };
    const untyped = planFileSample("uploaded PDF without a type");
    const pdf = await new QueryClient().query(
      planFileRead(context(), files, ids, untyped)
    );
    // The fixture server answers attachment 88001 with its link alone: not a PDF.
    const other = await new QueryClient().query(
      planFileRead(context(), files, ids, { ...untyped, id: "88001" })
    );
    expect({
      pdf: {
        ...pdf,
        uri: /^file:\/\/\/account-a\/plan-.+\.pdf$/u.test(pdf.uri),
      },
      bytes: atob(saved.get(pdf.uri) ?? "").slice(0, 4),
      other,
    }).toStrictEqual({
      pdf: {
        kind: "pdf",
        name: "Song - Bb (fixed)",
        uri: true,
      },
      bytes: "%PDF",
      other: {
        kind: "link",
        name: "Song - Bb (fixed)",
        uri: "https://fixtures.invalid/attachments/88001",
      },
    });
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
