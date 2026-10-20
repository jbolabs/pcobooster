import { callForQuery } from "@pcobooster/client/query";
import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { MAX_PREVIEW_BYTES } from "../../songs/attachments";
import {
  isPdfBase64,
  PreviewError,
  previewFolderSegment,
  safeFileName,
  secureUrl,
} from "../../songs/previews";
import type { PreviewFiles } from "../../songs/previews";
import type { PlanIds, PlanReadContext } from "../reads";
import { planFileKind } from "./model";

export const planFilesKey = (scope: string, ids: PlanIds) =>
  [scope, "planFiles.list", ids.serviceTypeId, ids.planId] as const;

export const planFilesRead = (
  { client, scope }: PlanReadContext,
  ids: PlanIds
) =>
  infiniteQueryOptions({
    queryKey: planFilesKey(scope, ids),
    initialPageParam: 0,
    queryFn: async (context) =>
      await callForQuery(context, client, (api) =>
        api.planFiles.list({
          params: ids,
          query:
            context.pageParam === 0
              ? {}
              : { offset: String(context.pageParam) },
        })
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    staleTime: 60_000,
  });

export const planFileRead = (
  { client, scope }: PlanReadContext,
  files: PreviewFiles,
  ids: PlanIds,
  file: PlanFile
) => {
  const kind = planFileKind(file);
  return queryOptions({
    queryKey: [
      scope,
      "preview.planFile",
      ids.serviceTypeId,
      ids.planId,
      file.id,
      file.filename,
      file.size,
    ] as const,
    queryFn: async (context) => {
      const writer = files.begin(scope, context.signal);
      if (
        (kind === "pdf" || kind === "document") &&
        file.size > MAX_PREVIEW_BYTES
      ) {
        throw new Error("This file is too large to preview on this device.");
      }
      const result = await callForQuery(context, client, (api) =>
        api.planFiles.open({
          params: { ...ids, attachmentId: file.id },
          query: kind === "pdf" ? { as: "pdf" } : {},
        })
      );
      const name = safeFileName(file.filename || file.name, "Attachment");
      const folder = `plan-${previewFolderSegment(ids.serviceTypeId, ids.planId, file.id)}`;
      if (kind === "pdf") {
        if (result.data === undefined || !isPdfBase64(result.data)) {
          throw new PreviewError("undrawable");
        }
        return {
          uri: writer.writeBase64(
            folder,
            name.endsWith(".pdf") ? name : `${name}.pdf`,
            result.data
          ),
          name,
        };
      }
      const url = secureUrl(result.url);
      if (url === null) {
        throw new PreviewError("insecure-link");
      }
      if (kind === "document") {
        return { uri: await writer.download(folder, name, url), name };
      }
      if (kind === "audio" || kind === "video") {
        return { uri: await writer.playable(folder, name, url), name };
      }
      return { uri: url.href, name };
    },
    staleTime: (query) => {
      const uri = query.state.data?.uri;
      return uri !== undefined && uri.startsWith("file:") && files.exists(uri)
        ? Number.POSITIVE_INFINITY
        : 0;
    },
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};
