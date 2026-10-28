/**
 * Tell IndexNow search engines (Bing, Yandex, Seznam, Naver, and the AI search tools built on
 * Bing's index) which public pages a production deploy changed, so they recrawl them within
 * hours instead of waiting for the sitemap to be read again.
 *
 *   bun scripts/search/indexnow.ts snapshot <origin> <file>   # before the deploy
 *   bun scripts/search/indexnow.ts submit <origin> <file>     # after the deploy is verified
 *
 * `snapshot` records a digest of every sitemap page; `submit` compares the deployed pages with
 * it and submits the changed and new URLs. Until the key file is live (the first deploy that
 * serves it) and whenever the snapshot is missing, every sitemap URL is submitted.
 *
 * Pass the Worker's workers.dev origin, never pcobooster.com: Bot Fight Mode challenges CI
 * runners there. Pages are read by path from that origin and submitted under pcobooster.com.
 * The deploy has already succeeded, so a failure is reported as a warning and never fails the
 * job.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { Option, Schema } from "effect";

import {
  INDEXNOW_KEY,
  INDEXNOW_KEY_PATH,
} from "../../apps/web/src/lib/indexnow";

const SITE_ORIGIN = "https://pcobooster.com";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** IndexNow accepts at most 10,000 URLs per request. */
const MAX_URLS_PER_REQUEST = 10_000;
const PAGE_FETCH_CONCURRENCY = 8;

type Fetch = typeof fetch;

const LOC_PATTERN = /<loc>\s*(?<loc>[^<\s]+)\s*<\/loc>/gu;
const SCRIPT_OR_STYLE = /<(?<tag>script|style)\b[^>]*>[\s\S]*?<\/\k<tag>>/giu;
const LINK_TAG = /<link\b[^>]*>/giu;
const HASHED_ASSET = /\/marketing\/assets\/[\w.-]+/gu;
const WHITESPACE = /\s+/gu;

/** Every `<loc>` in a sitemap, in order. */
export const readSitemapUrls = (sitemapXml: string): string[] =>
  [...sitemapXml.matchAll(LOC_PATTERN)].map((match) => match.groups?.loc ?? "");

/**
 * A digest of what a search engine reads on a page. Scripts, styles, and `<link>` tags are left
 * out and hashed asset names are masked, so a rebuild that only renames bundles reads as
 * unchanged.
 */
export const pageDigest = (html: string): string =>
  createHash("sha256")
    .update(
      html
        .replace(SCRIPT_OR_STYLE, "")
        .replace(LINK_TAG, "")
        .replace(HASHED_ASSET, "/marketing/assets/*")
        .replace(WHITESPACE, " ")
        .trim()
    )
    .digest("hex");

const SnapshotSchema = Schema.Struct({
  keyServed: Schema.Boolean,
  pages: Schema.Record(Schema.String, Schema.String),
});
export type Snapshot = typeof SnapshotSchema.Type;

const decodeSnapshot = Schema.decodeUnknownOption(
  Schema.fromJsonString(SnapshotSchema)
);

/** The URLs to submit: new or changed pages, or all of them when IndexNow has no key yet. */
export const urlsToSubmit = (
  before: Snapshot | undefined,
  after: Snapshot["pages"]
): string[] => {
  const urls = Object.keys(after);
  if (before === undefined || !before.keyServed) {
    return urls;
  }
  return urls.filter((url) => before.pages[url] !== after[url]);
};

const onOrigin = (url: string, origin: string): string => {
  const { pathname, search } = new URL(url);
  return `${origin.replace(/\/$/u, "")}${pathname}${search}`;
};

const fetchText = async (url: string, fetchImpl: Fetch): Promise<string> => {
  const response = await fetchImpl(url, { redirect: "manual" });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return await response.text();
};

/** Whether the origin serves the IndexNow key file with the expected key. */
const keyIsServed = async (
  origin: string,
  fetchImpl: Fetch
): Promise<boolean> => {
  try {
    const body = await fetchText(
      onOrigin(`${SITE_ORIGIN}${INDEXNOW_KEY_PATH}`, origin),
      fetchImpl
    );
    return body.trim() === INDEXNOW_KEY;
  } catch {
    return false;
  }
};

/** Digest every sitemap page the origin serves, keyed by its pcobooster.com URL. */
export const takeSnapshot = async (
  origin: string,
  fetchImpl: Fetch = fetch
): Promise<Snapshot> => {
  const sitemap = await fetchText(
    onOrigin(`${SITE_ORIGIN}/sitemap.xml`, origin),
    fetchImpl
  );
  const urls = readSitemapUrls(sitemap);
  const pages: Record<string, string> = {};
  for (let start = 0; start < urls.length; start += PAGE_FETCH_CONCURRENCY) {
    const batch = urls.slice(start, start + PAGE_FETCH_CONCURRENCY);
    // oxlint-disable-next-line no-await-in-loop -- Batches keep the Worker's load bounded.
    const digests = await Promise.all(
      batch.map(async (url) =>
        pageDigest(await fetchText(onOrigin(url, origin), fetchImpl))
      )
    );
    for (const [index, url] of batch.entries()) {
      pages[url] = digests[index] ?? "";
    }
  }
  return { keyServed: await keyIsServed(origin, fetchImpl), pages };
};

export type SubmitResult =
  | { readonly status: "submitted"; readonly count: number }
  | { readonly status: "unchanged" }
  | { readonly status: "failed"; readonly reason: string };

/** Submit URLs to IndexNow, which shares them with every participating search engine. */
export const submitUrls = async (
  urls: readonly string[],
  fetchImpl: Fetch = fetch
): Promise<SubmitResult> => {
  if (urls.length === 0) {
    return { status: "unchanged" };
  }
  for (let start = 0; start < urls.length; start += MAX_URLS_PER_REQUEST) {
    // oxlint-disable-next-line no-await-in-loop -- IndexNow takes one batch at a time.
    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: new URL(SITE_ORIGIN).host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_ORIGIN}${INDEXNOW_KEY_PATH}`,
        urlList: urls.slice(start, start + MAX_URLS_PER_REQUEST),
      }),
    });
    if (!response.ok) {
      return {
        status: "failed",
        reason: `IndexNow returned ${response.status}`,
      };
    }
  }
  return { status: "submitted", count: urls.length };
};

const readSnapshot = async (file: string): Promise<Snapshot | undefined> => {
  try {
    return Option.getOrUndefined(decodeSnapshot(await readFile(file, "utf-8")));
  } catch {
    return undefined;
  }
};

const warn = (message: string): void => {
  console.warn(`::warning::IndexNow: ${message}`);
};

const main = async ([command, origin, file]: readonly string[]) => {
  if (origin === undefined || file === undefined) {
    throw new Error(
      "Usage: bun scripts/search/indexnow.ts <snapshot|submit> <origin> <file>"
    );
  }
  try {
    if (command === "snapshot") {
      await writeFile(file, JSON.stringify(await takeSnapshot(origin)));
      return;
    }
    if (command !== "submit") {
      throw new Error(`Unknown command ${command ?? ""}`);
    }
    const before = await readSnapshot(file);
    if (before === undefined) {
      warn("no snapshot from before the deploy; submitting every page");
    }
    const after = await takeSnapshot(origin);
    if (!after.keyServed) {
      warn(`${INDEXNOW_KEY_PATH} is not served; skipping the submission`);
      return;
    }
    const result = await submitUrls(urlsToSubmit(before, after.pages));
    if (result.status === "failed") {
      warn(result.reason);
    } else if (result.status === "submitted") {
      console.info(`IndexNow: submitted ${result.count} URLs`);
    } else {
      console.info("IndexNow: no public page changed");
    }
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
  }
};

if (import.meta.main) {
  await main(process.argv.slice(2));
}
