// @vitest-environment happy-dom
import { setTimeout as delay } from "node:timers/promises";

import { planFileSample } from "@pcobooster/contracts/http/plan-files.fixture";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { PlanFileViewer } from "@/components/schedule/plan-file-viewer";

describe("a file Planning Center gives no type", () => {
  it("asks for it as a PDF, and offers the original when it isn't one", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
        await Promise.resolve();
        const url = new URL(input instanceof Request ? input.url : input);
        requested.push(`${url.pathname}${url.search}`);
        // The server found no PDF signature, so it answers with the link alone.
        return Response.json({
          url: "https://files.example/song",
          preview: false,
        });
      })
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        await Promise.resolve();
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(PlanFileViewer, {
              serviceTypeId: "1",
              planId: "2",
              file: planFileSample("uploaded PDF without a type"),
            })
          )
        );
      });
      await act(async () => {
        await delay(80);
      });
      expect({
        requested,
        message: container.querySelector("[data-slot=empty-title]")
          ?.textContent,
        originals: [...container.querySelectorAll("a[target=_blank]")].map(
          (link) => link.getAttribute("aria-label") ?? link.textContent
        ),
      }).toStrictEqual({
        requested: [
          "/api/v1/service-types/1/plans/2/files/uploaded-pdf-without-a-type/link?as=pdf",
        ],
        message: "No preview for this file",
        originals: ["Open original", "Open original"],
      });
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      client.clear();
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
