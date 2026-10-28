import { describe, expect, it } from "vitest";

import {
  canonicalUrl,
  marketingAssetUrl,
  pageHead,
  pageTitle,
  siteHead,
} from "./site-head";

describe(canonicalUrl, () => {
  it.each([
    ["/", "https://pcobooster.com"],
    ["/about", "https://pcobooster.com/about"],
  ])("maps %s to %s", (pathname, expected) => {
    expect(canonicalUrl(pathname)).toBe(expected);
  });
});

describe(pageTitle, () => {
  it("uses the site default without a page title", () => {
    expect(pageTitle()).toBe(
      "PCOBooster | The Workspace for Planning Center Services"
    );
  });

  it("suffixes page titles with the site name", () => {
    expect(pageTitle("Our story")).toBe("Our story · PCOBooster");
  });
});

describe(pageHead, () => {
  it.each([
    ["/", "https://pcobooster.com", "og-home.png"],
    ["/about", "https://pcobooster.com/about", "og-about.png"],
    [
      "/key-transitions",
      "https://pcobooster.com/key-transitions",
      "og-home.png",
    ],
  ] as const)(
    "gives %s a distinct canonical and sharing image",
    (pathname, url, image) => {
      const head = pageHead({
        title: pathname === "/about" ? "Our story" : undefined,
        description: "Page description",
        pathname,
      });
      expect(head.links).toContainEqual({ rel: "canonical", href: url });
      expect(head.meta).toContainEqual({ property: "og:url", content: url });
      expect(head.meta).toContainEqual({
        property: "og:image",
        content: `https://pcobooster.com/marketing/${image}`,
      });
      expect(head.meta).toContainEqual({
        name: "twitter:card",
        content: "summary_large_image",
      });
      expect(head.meta).toContainEqual({
        name: "description",
        content: "Page description",
      });
    }
  );
});

describe(pageHead, () => {
  it("keeps a noindex page out of search results while following its links", () => {
    const head = pageHead({
      description: "Page description",
      pathname: "/key-transitions",
      noindex: true,
    });
    expect(head.meta).toContainEqual({
      name: "robots",
      content: "noindex, follow",
    });
  });
});

describe(siteHead, () => {
  const { meta, links } = siteHead();

  it("serves the icon from the marketing asset prefix", () => {
    expect(links).toStrictEqual([
      { rel: "icon", href: marketingAssetUrl("icon.svg") },
    ]);
    expect(marketingAssetUrl("icon.svg")).toBe("/marketing/icon.svg");
  });

  it("does not repeat a name, which the router would collapse to the last tag", () => {
    const names = meta.flatMap((tag) => ("name" in tag ? [tag.name] : []));
    expect(new Set(names).size).toBe(names.length);
  });
});
