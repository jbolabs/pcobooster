import { describe, expect, it } from "vitest";

import {
  pageDigest,
  readSitemapUrls,
  submitUrls,
  takeSnapshot,
  urlsToSubmit,
} from "./indexnow";

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://pcobooster.com/</loc>
    <lastmod>2026-10-26</lastmod>
  </url>
  <url>
    <loc>https://pcobooster.com/key-transitions/b-to-b-flat</loc>
    <lastmod>2026-10-26</lastmod>
  </url>
</urlset>`;

const forbidden: typeof fetch = async () =>
  await Promise.resolve(new Response(null, { status: 403 }));

describe(readSitemapUrls, () => {
  it("lists every location in order", () => {
    expect(readSitemapUrls(sitemap)).toStrictEqual([
      "https://pcobooster.com/",
      "https://pcobooster.com/key-transitions/b-to-b-flat",
    ]);
  });
});

describe(pageDigest, () => {
  it("hashes the page without scripts, links, or bundle hashes", () => {
    const html =
      '<html><head><title>B to Bb</title><link rel="modulepreload" href="/marketing/assets/index-Ab12.js"/>' +
      "<script>window.$_TSR={}</script></head><body><p>Half step down</p>\n  " +
      '<img src="/marketing/assets/hero-Xy9.webp"/></body></html>';
    // sha256 of `<html><head><title>B to Bb</title></head><body><p>Half step down</p> <img src="/marketing/assets/*"/></body></html>`.
    expect(pageDigest(html)).toBe(
      "363209505e0f3b160aa63b2d9b6b34d0fbecf48d2cc7c2da6da24b68a45a6ade"
    );
  });
});

describe(urlsToSubmit, () => {
  const after = {
    "https://pcobooster.com/": "home-2",
    "https://pcobooster.com/about": "about-1",
    "https://pcobooster.com/key-transitions/b-to-b-flat": "pair-1",
  };

  it("submits only new and changed pages once the key is live", () => {
    expect(
      urlsToSubmit(
        {
          keyServed: true,
          pages: {
            "https://pcobooster.com/": "home-1",
            "https://pcobooster.com/about": "about-1",
          },
        },
        after
      )
    ).toStrictEqual([
      "https://pcobooster.com/",
      "https://pcobooster.com/key-transitions/b-to-b-flat",
    ]);
  });

  it("submits every page on the first deploy that serves the key", () => {
    expect(
      urlsToSubmit(
        {
          keyServed: false,
          pages: {
            "https://pcobooster.com/": "home-2",
            "https://pcobooster.com/about": "about-1",
            "https://pcobooster.com/key-transitions/b-to-b-flat": "pair-1",
          },
        },
        after
      )
    ).toStrictEqual([
      "https://pcobooster.com/",
      "https://pcobooster.com/about",
      "https://pcobooster.com/key-transitions/b-to-b-flat",
    ]);
  });
});

describe(takeSnapshot, () => {
  it("reads the sitemap pages and key file from the given origin", async () => {
    const responses = new Map([
      ["https://web.example.workers.dev/sitemap.xml", sitemap],
      ["https://web.example.workers.dev/", "<p>Home</p>"],
      [
        "https://web.example.workers.dev/key-transitions/b-to-b-flat",
        "<p>Pair</p>",
      ],
      [
        "https://web.example.workers.dev/c2d95222b2bd4d26cc55e31663139aa3.txt",
        "c2d95222b2bd4d26cc55e31663139aa3",
      ],
    ]);
    const fakeFetch: typeof fetch = async (input, init) => {
      const body = responses.get(new Request(input, init).url);
      return await Promise.resolve(
        body === undefined
          ? new Response("missing", { status: 404 })
          : new Response(body)
      );
    };

    const snapshot = await takeSnapshot(
      "https://web.example.workers.dev",
      fakeFetch
    );

    expect(snapshot).toStrictEqual({
      keyServed: true,
      pages: {
        // sha256 of `<p>Home</p>` and `<p>Pair</p>`.
        "https://pcobooster.com/":
          "bb4450da4abb724627b177d582fbefa16270f2762897b7dfdd7e31aa651fc553",
        "https://pcobooster.com/key-transitions/b-to-b-flat":
          "ab635a6fc09e9b71af58cc90534d9b3980b2a754ce700975b95c0bb06d80fdfc",
      },
    });
  });
});

describe(submitUrls, () => {
  it("posts the URLs with the site's key", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, body: await request.json() });
      return new Response(null, { status: 202 });
    };

    await expect(
      submitUrls(
        ["https://pcobooster.com/key-transitions/b-to-b-flat"],
        fakeFetch
      )
    ).resolves.toStrictEqual({ status: "submitted", count: 1 });
    expect(requests).toStrictEqual([
      {
        url: "https://api.indexnow.org/indexnow",
        body: {
          host: "pcobooster.com",
          key: "c2d95222b2bd4d26cc55e31663139aa3",
          keyLocation:
            "https://pcobooster.com/c2d95222b2bd4d26cc55e31663139aa3.txt",
          urlList: ["https://pcobooster.com/key-transitions/b-to-b-flat"],
        },
      },
    ]);
  });

  it("reports a rejected submission", async () => {
    await expect(
      submitUrls(["https://pcobooster.com/"], forbidden)
    ).resolves.toStrictEqual({
      status: "failed",
      reason: "IndexNow returned 403",
    });
  });
});
