// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Fragment, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SongRecordingPlayer } from "@/components/songs/song-recording-player";
import type { SongAttachment } from "@/hooks/use-song-attachments";
import { queryKeys } from "@/lib/query-keys";

const recording = (keyId: string): SongAttachment => ({
  id: `track-${keyId}`,
  keyId,
  name: `${keyId} mix`,
  filename: "mix.mp3",
  kind: "audio",
  contentType: "audio/mpeg",
  fileSize: null,
  linkUrl: null,
  downloadable: false,
  streamable: true,
});

describe("chart playback reset boundary", () => {
  it("changes key-specific recordings without replacing the editor or its selection", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const client = new QueryClient();
    client.setQueryData(queryKeys.songAttachments("100", "200"), {
      attachments: [recording("G"), recording("A")],
      truncated: false,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const view = (keyId: string) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(SongRecordingPlayer, {
          songId: "100",
          arrangementId: "200",
          keyId,
          songTitle: "Example song",
          // oxlint-disable-next-line react/no-children-prop -- A function-valued render prop goes in createElement's props argument.
          children: (video, controls) =>
            createElement(
              Fragment,
              null,
              createElement("textarea", {
                "aria-label": "Chart",
                defaultValue: "My chart draft",
              }),
              video,
              controls
            ),
        })
      );
    try {
      await act(async () => {
        root.render(view("G"));
        await Promise.resolve();
      });
      const editor = container.querySelector("textarea");
      if (editor === null) {
        throw new Error("Expected the chart editor");
      }
      editor.setSelectionRange(3, 8);
      await act(async () => {
        root.render(view("A"));
        await Promise.resolve();
      });
      expect(container.querySelector("textarea")).toBe(editor);
      expect([editor.selectionStart, editor.selectionEnd]).toStrictEqual([
        3, 8,
      ]);
      expect(container.querySelector("select")?.value).toBe("A:track-A");
      expect(editor.value).toBe("My chart draft");
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
