export interface ResizedImage {
  original: string;
  small: string;
  hero: string;
}

/** Transform only verified JPEG paths; PNGs may lose transparency when converted. */
export function resizeEpicImage(value: string): ResizedImage | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "cdn1.epicgames.com" || url.port || url.username || url.password || value.includes("?") || value.includes("#")) return null;
    if (!/^\/spt-assets\/[a-f0-9]{32}\/[a-z0-9_-]+\.jpg$/i.test(url.pathname)) return null;
    return { original: value, small: `${value}?resize=1&w=640&h=360`, hero: `${value}?resize=1&w=960&h=540` };
  } catch { return null; }
}

export function originalImageFallback(original: string, alreadyRetried: boolean): string | null {
  return alreadyRetried ? null : original;
}

export function imageSizes(section: string, firstCard: boolean): string {
  if (section === "upcoming") return "(min-width: 768px) 144px, calc(100vw - 32px)";
  if (section === "ended") return "(min-width: 768px) 160px, calc(100vw - 32px)";
  if (section === "ending" && firstCard) return "(min-width: 1200px) 560px, (min-width: 768px) calc((100vw - 80px) / 2), calc(100vw - 32px)";
  return "(min-width: 1200px) 272px, (min-width: 1024px) calc((100vw - 112px) / 4), (min-width: 768px) calc((100vw - 80px) / 2), calc(100vw - 32px)";
}
