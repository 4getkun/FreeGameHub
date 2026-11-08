import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";

export function socialUrlTags(siteUrl: string | undefined): HtmlTagDescriptor[] {
  if (!siteUrl?.trim()) return [];
  let url: URL;
  try {
    url = new URL(siteUrl.trim());
  } catch {
    throw new Error("SITE_URL must be an absolute HTTP or HTTPS URL");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("SITE_URL must be an absolute HTTP or HTTPS URL without credentials");
  }
  const imageUrl = new URL("/og.png", url).href;
  return [
    { tag: "link", attrs: { rel: "canonical", href: url.href }, injectTo: "head" },
    { tag: "meta", attrs: { property: "og:url", content: url.href }, injectTo: "head" },
    { tag: "meta", attrs: { property: "og:image", content: imageUrl }, injectTo: "head" },
    { tag: "meta", attrs: { name: "twitter:image", content: imageUrl }, injectTo: "head" }
  ];
}

export function socialMetadataPlugin(): Plugin {
  return {
    name: "freegamehub-social-metadata",
    transformIndexHtml: () => socialUrlTags(process.env.SITE_URL),
    generateBundle() {
      const urlTag = socialUrlTags(process.env.SITE_URL).find(tag => tag.attrs?.property === "og:url");
      if (!urlTag || typeof urlTag.attrs?.content !== "string") return;
      const siteUrl = urlTag.attrs.content;
      const xmlUrl = siteUrl.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${xmlUrl}</loc></url></urlset>\n` });
      const robots = readFileSync(resolve("public/robots.txt"), "utf8").trimEnd();
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `${robots}\nSitemap: ${new URL("/sitemap.xml", siteUrl).href}\n` });
    }
  };
}

export default defineConfig({ plugins: [socialMetadataPlugin()] });
