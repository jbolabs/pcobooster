// @vitest-environment happy-dom
import { setTimeout as delay } from "node:timers/promises";

import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";

import { PlanFileViewer } from "@/components/schedule/plan-file-viewer";

const file: PlanFile = {
  id: "3",
  name: "Mix",
  filename: "mix.mp3",
  contentType: "audio/mpeg",
  fileType: "audio",
  providerType: "Attachment",
  size: 100,
  hasPreview: false,
  downloadable: false,
  streamable: true,
  ownerType: "Plan",
  ownerId: "2",
};
const settle = async () => {
  await act(async () => {
    await delay(80);
  });
};

describe("manual audio recovery", () => {
  it("Refresh link recovers a preview after automatic retry exhaustion", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        await Promise.resolve();
        requests += 1;
        return Response.json({
          url: `https://files.example/${String(requests)}.mp3`,
          preview: false,
        });
      })
    );
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const button = (label: string) => {
      const element = [...container.querySelectorAll("button")].find(
        (candidate) =>
          candidate.textContent?.includes(label) ||
          candidate.getAttribute("aria-label") === label
      );
      if (element === undefined) {
        throw new Error(`Missing ${label}: ${container.textContent}`);
      }
      return element;
    };
    const audio = () => {
      const a = container.querySelector("audio");
      if (!a) {
        throw new Error(`Missing audio: ${container.textContent}`);
      }
      return a;
    };
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
              file,
            })
          )
        );
      });
      await settle();
      await act(async () => {
        button("Play").click();
        await Promise.resolve();
      });
      await act(async () => {
        audio().dispatchEvent(new Event("error"));
        await Promise.resolve();
      });
      await settle();
      await act(async () => {
        audio().dispatchEvent(new Event("error"));
        await Promise.resolve();
      });
      await settle();
      expect({
        retryEnabled: !button("Retry playback").disabled,
      }).toStrictEqual({ retryEnabled: true });
      await act(async () => {
        button("Refresh link").click();
        await Promise.resolve();
      });
      await settle();
      expect({
        requests,
        audio: container.querySelector("audio")?.src,
        failed: container.textContent?.includes("This recording couldn’t play"),
      }).toStrictEqual({
        requests: 3,
        audio: "https://files.example/3.mp3",
        failed: false,
      });
    } finally {
      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      client.clear();
      container.remove();
      play.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
