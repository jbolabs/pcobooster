import {
  isProviderFileUrl,
  listPlanFiles,
  normalizePlanFile,
  openPlanFile,
} from "@pcobooster/api/modules/planning-center/plan-files";
import type { PlanFilesService } from "@pcobooster/api/modules/planning-center/plan-files";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const KEY_OWNER = { type: "Key", id: "550111" };

const attachment = (
  attributes: PCResource["attributes"],
  owner: { type: string; id: string } | null = KEY_OWNER
): PCResource => ({
  id: "901",
  type: "Attachment",
  attributes,
  relationships: owner === null ? {} : { attachable: { data: owner } },
});

const pdfBytes = new TextEncoder().encode("%PDF-1.7 chart");
const SIGNED = "https://bucket.s3.amazonaws.com/chart.pdf?sig=abc";

/** A fake Planning Center: one stored file, and the links its `open`/`preview` actions give. */
const planningCenter = (
  attributes: PCResource["attributes"],
  links: { open?: string; preview?: string } = {}
) => {
  const opened: boolean[] = [];
  const plans: PlanFilesService = {
    getPlanAttachmentsPage: () =>
      Effect.succeed({ data: [], included: [], nextOffset: null }),
    getPlanAttachment: () => Effect.succeed(attachment(attributes)),
    openPlanAttachment: (_serviceTypeId, _planId, _attachmentId, preview) => {
      opened.push(preview);
      return Effect.succeed(
        (preview ? links.preview : links.open) ?? "https://files.example/x"
      );
    },
  };
  return { plans, opened };
};

const input = {
  serviceTypeId: "78289",
  planId: "89633542",
  attachmentId: "901",
};

const respond = (responses: Response[]): typeof globalThis.fetch => {
  const queue = [...responses];
  return async () => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("Unexpected download");
    }
    return await Promise.resolve(next);
  };
};

describe(normalizePlanFile, () => {
  it("keeps the owner and honors a song's mp3 download block", () => {
    expect(
      normalizePlanFile(
        attachment({
          filename: "Demo.mp3",
          content_type: "audio/mpeg",
          file_size: 2_516_582,
          downloadable: true,
          allow_mp3_download: false,
          web_streamable: true,
          pco_type: "AttachmentS3",
        })
      )
    ).toStrictEqual({
      id: "901",
      name: "Demo.mp3",
      filename: "Demo.mp3",
      contentType: "audio/mpeg",
      fileType: "",
      providerType: "AttachmentS3",
      size: 2_516_582,
      hasPreview: false,
      downloadable: false,
      streamable: true,
      ownerType: "Key",
      ownerId: "550111",
    });
  });

  it("treats a file without an owner as the plan's own", () => {
    const file = normalizePlanFile(
      attachment({ display_name: "Run sheet" }, null)
    );
    expect([file.name, file.ownerType, file.ownerId]).toStrictEqual([
      "Run sheet",
      "Plan",
      null,
    ]);
  });
});

describe(listPlanFiles, () => {
  it("returns Planning Center's next offset so the browser can keep reading", async () => {
    const pages = await Effect.runPromise(
      listPlanFiles(
        { serviceTypeId: "78289", planId: "89633542", offset: 100 },
        {
          getPlanAttachmentsPage: (_serviceTypeId, _planId, offset) =>
            Effect.succeed({
              data: [attachment({ display_name: `From ${String(offset)}` })],
              included: [],
              nextOffset: offset + 100,
            }),
        }
      )
    );
    expect([
      pages.files.map((file) => file.name),
      pages.nextOffset,
    ]).toStrictEqual([["From 100"], 200]);
  });
});

describe(openPlanFile, () => {
  it("returns the signed link for a downloadable file", async () => {
    const { plans, opened } = planningCenter(
      { downloadable: true },
      { open: SIGNED }
    );
    await expect(
      Effect.runPromise(openPlanFile(input, { plans, fetch: respond([]) }))
    ).resolves.toStrictEqual({ url: SIGNED, preview: false });
    expect(opened).toStrictEqual([false]);
  });

  it("opens Planning Center's preview when the file itself is restricted", async () => {
    const { plans } = planningCenter(
      { downloadable: false, has_preview: true },
      { preview: "https://files.example/preview.jpg" }
    );
    await expect(
      Effect.runPromise(openPlanFile(input, { plans, fetch: respond([]) }))
    ).resolves.toStrictEqual({
      url: "https://files.example/preview.jpg",
      preview: true,
    });
  });

  it("refuses a file Planning Center lets no one preview, stream, or download", async () => {
    const { plans, opened } = planningCenter({
      downloadable: false,
      web_streamable: false,
      has_preview: false,
      pco_type: "AttachmentS3",
    });
    const error = await Effect.runPromise(
      Effect.flip(openPlanFile(input, { plans, fetch: respond([]) }))
    );
    expect([error._tag, opened]).toStrictEqual(["Forbidden", []]);
  });

  it("rejects an insecure link from Planning Center", async () => {
    const { plans } = planningCenter(
      { downloadable: true },
      { open: "http://files.example/chart.pdf" }
    );
    const error = await Effect.runPromise(
      Effect.flip(openPlanFile(input, { plans, fetch: respond([]) }))
    );
    expect(error.message).toBe(
      "Planning Center did not return a secure link to this file."
    );
  });

  it("returns the PDF itself, following a redirect within Planning Center's storage", async () => {
    const { plans } = planningCenter({ downloadable: true }, { open: SIGNED });
    const link = await Effect.runPromise(
      openPlanFile(
        { ...input, as: "pdf" },
        {
          plans,
          fetch: respond([
            new Response(null, {
              status: 302,
              headers: {
                location: "https://bucket.s3.amazonaws.com/final.pdf",
              },
            }),
            new Response(pdfBytes),
          ]),
        }
      )
    );
    expect(link.data).toBe(btoa("%PDF-1.7 chart"));
  });

  it("won't follow a redirect away from Planning Center's storage", async () => {
    const { plans } = planningCenter({ downloadable: true }, { open: SIGNED });
    const error = await Effect.runPromise(
      Effect.flip(
        openPlanFile(
          { ...input, as: "pdf" },
          {
            plans,
            fetch: respond([
              new Response(null, {
                status: 302,
                headers: { location: "https://127.0.0.1/private" },
              }),
            ]),
          }
        )
      )
    );
    expect(error.message).toBe(
      "This linked PDF must be opened in its own viewer."
    );
  });

  it("rejects a download that isn't a PDF", async () => {
    const { plans } = planningCenter({ downloadable: true }, { open: SIGNED });
    const error = await Effect.runPromise(
      Effect.flip(
        openPlanFile(
          { ...input, as: "pdf" },
          { plans, fetch: respond([new Response("<html>login</html>")]) }
        )
      )
    );
    expect(error.message).toBe(
      "This file is not a PDF. Open the original file instead."
    );
  });
});

describe(isProviderFileUrl, () => {
  it.each([
    ["https://bucket.s3.amazonaws.com/chart.pdf", true],
    ["https://files.planningcenteronline.com/chart.pdf", true],
    ["http://bucket.s3.amazonaws.com/chart.pdf", false],
    ["https://127.0.0.1/chart.pdf", false],
    ["https://amazonaws.com.evil.example/chart.pdf", false],
    ["https://user:pass@bucket.s3.amazonaws.com/chart.pdf", false],
    ["https://bucket.s3.amazonaws.com:8443/chart.pdf", false],
  ])("%s → %s", (url, allowed) => {
    expect(isProviderFileUrl(url)).toBe(allowed);
  });
});
