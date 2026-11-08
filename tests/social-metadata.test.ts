// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { socialMetadataPlugin, socialUrlTags } from "../vite.config";

async function renderedHead(): Promise<Document> {
  const server = await createServer({ configFile: false, plugins: [socialMetadataPlugin()], server: { middlewareMode: true } });
  try {
    const html = await readFile("index.html", "utf8");
    return new DOMParser().parseFromString(await server.transformIndexHtml("/index.html", html), "text/html");
  } finally {
    await server.close();
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("social metadata", () => {
  it("omits URL-dependent tags without SITE_URL and retains the static metadata", async () => {
    vi.stubEnv("SITE_URL", "");
    const doc = await renderedHead();
    for (const selector of ['meta[property="og:image"]', 'meta[property="og:url"]', 'meta[name="twitter:image"]']) {
      expect(doc.head.querySelector(selector)).toBeNull();
    }
    expect(doc.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toContain("FreeGameHub");
    expect(doc.head.querySelector('meta[property="og:description"]')?.getAttribute("content")).toBeTruthy();
    expect(doc.head.querySelector('meta[property="og:type"]')?.getAttribute("content")).toBe("website");
    expect(doc.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
    expect(doc.head.querySelector('link[rel="icon"][href="/favicon.ico"]')?.getAttribute("sizes")).toBe("any");
    expect(doc.head.querySelector('link[rel="icon"][href="/favicon.svg"]')?.getAttribute("type")).toBe("image/svg+xml");
    expect(doc.head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe("/apple-touch-icon.png");
    expect(doc.head.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#0E1014");
  });

  it("generates absolute site and image URLs from SITE_URL", async () => {
    vi.stubEnv("SITE_URL", "https://example.test/path/?a=1&b=2");
    const doc = await renderedHead();
    expect(doc.head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe("https://example.test/path/?a=1&b=2");
    expect(doc.head.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe("https://example.test/og.png");
    expect(doc.head.querySelector('meta[name="twitter:image"]')?.getAttribute("content")).toBe("https://example.test/og.png");
  });

  it("rejects invalid, non-HTTP and credential-bearing site URLs", () => {
    for (const url of ["/relative", "javascript:alert(1)", "https://user:password@example.test/"]) {
      expect(() => socialUrlTags(url)).toThrow(/SITE_URL/);
    }
  });
});
