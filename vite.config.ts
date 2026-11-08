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
    { tag: "meta", attrs: { property: "og:url", content: url.href }, injectTo: "head" },
    { tag: "meta", attrs: { property: "og:image", content: imageUrl }, injectTo: "head" },
    { tag: "meta", attrs: { name: "twitter:image", content: imageUrl }, injectTo: "head" }
  ];
}

export function socialMetadataPlugin(): Plugin {
  return { name: "freegamehub-social-metadata", transformIndexHtml: () => socialUrlTags(process.env.SITE_URL) };
}

export default defineConfig({ plugins: [socialMetadataPlugin()] });
