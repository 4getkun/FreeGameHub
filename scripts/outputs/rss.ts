import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Game, GamesFile, Store } from "../../src/shared/types";

const STORES: Store[] = ["epic", "steam", "gog", "itch", "prime", "other"];
const TYPE_LABELS: Record<Game["type"], string> = {
  game: "", dlc: "[DLC] ", loot: "[ゲーム内アイテム] ", beta: "[ベータ] ", other: "[その他] "
};

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function itemXml(game: Game): string {
  const title = `${TYPE_LABELS[game.type]}${game.title}`;
  const description = game.summaryJa ?? game.descriptionOrig ?? "";
  return [
    "    <item>",
    `      <title>${xml(title)}</title>`,
    `      <link>${xml(game.url)}</link>`,
    `      <guid isPermaLink="false">${xml(game.id)}</guid>`,
    `      <description>${xml(description)}</description>`,
    `      <category>${xml(game.type)}</category>`,
    game.startAt ? `      <pubDate>${new Date(game.startAt).toUTCString()}</pubDate>` : "",
    "    </item>"
  ].filter(Boolean).join("\n");
}

function feedXml(title: string, siteUrl: string, items: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${xml(title)}</title>`,
    "    <description>新たに配布開始したゲーム</description>",
    `    <link>${xml(siteUrl)}</link>`,
    "    <language>ja</language>",
    ...items,
    "  </channel>",
    "</rss>",
    ""
  ].join("\n");
}

function decodeXml(value: string): string {
  return value.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

function mergeFeed(title: string, siteUrl: string, existing: string | undefined, games: Game[]): string {
  const oldItems = existing?.match(/\s*<item>[\s\S]*?<\/item>/g) ?? [];
  if (existing && (!validateRssFeed(existing) || (existing.match(/<item>/g)?.length ?? 0) !== oldItems.length)) {
    throw new Error(`Invalid existing RSS feed: ${title}`);
  }
  const ids = new Set(oldItems.flatMap(item => {
    const match = item.match(/<guid isPermaLink="false">([\s\S]*?)<\/guid>/);
    return match ? [decodeXml(match[1])] : [];
  }));
  const additions = games.filter(game => game.status === "active" && !ids.has(game.id))
    .filter((game, index, active) => active.findIndex(candidate => candidate.id === game.id) === index)
    .map(itemXml);
  if (!existing) return feedXml(title, siteUrl, additions);
  const retained = oldItems.map(item => item.trimEnd());
  const items = [...retained, ...additions];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0">', "  <channel>",
    `    <title>${xml(title)}</title>`, "    <description>新たに配布開始したゲーム</description>",
    `    <link>${xml(siteUrl)}</link>`, "    <language>ja</language>",
    ...items, "  </channel>", "</rss>", ""
  ].join("\n");
}

/** Appends newly started active offers while retaining existing RSS history. */
export function generateRssFeeds(
  newlyStartedGames: Game[],
  options: { siteUrl: string; existingFeeds?: Record<string, string> }
): Record<string, string> {
  if (!options.siteUrl.trim()) throw new Error("siteUrl must be provided");
  const existing = options.existingFeeds ?? {};
  const feeds: Record<string, string> = {
    "all.xml": mergeFeed("FreeGameHub - 全体", options.siteUrl, existing["all.xml"], newlyStartedGames)
  };
  for (const store of STORES) {
    const name = `${store}.xml`;
    feeds[name] = mergeFeed(`FreeGameHub - ${store}`, options.siteUrl, existing[name], newlyStartedGames.filter(game => game.store === store));
  }
  return feeds;
}

/** Performs basic structural and contract checks on a generated RSS feed. */
export function validateRssFeed(feed: string): boolean {
  return /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0">[\s\S]*<channel>[\s\S]*<\/channel>\n<\/rss>\n$/.test(feed) &&
    (feed.match(/<item>/g)?.length ?? 0) === (feed.match(/<guid isPermaLink="false">/g)?.length ?? 0);
}

export async function writeRssFeeds(
  newlyStartedGames: Game[],
  options: { siteUrl: string; outputDir?: string }
): Promise<void> {
  if (!options.siteUrl.trim()) throw new Error("siteUrl must be provided");
  const outputDir = options.outputDir ?? "public/feeds";
  const targetDir = resolve(outputDir);
  await mkdir(targetDir, { recursive: true });
  const existing: Record<string, string> = {};
  for (const name of ["all.xml", ...STORES.map(store => `${store}.xml`)]) {
    try { existing[name] = await readFile(resolve(targetDir, name), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const [name, feed] of Object.entries(generateRssFeeds(newlyStartedGames, { siteUrl: options.siteUrl, existingFeeds: existing }))) {
    if (!validateRssFeed(feed)) throw new Error(`Invalid RSS feed generated: ${name}`);
    await writeFile(resolve(targetDir, name), feed, "utf8");
  }
}

async function main(): Promise<void> {
  const input = resolve(process.argv[2] ?? "public/data/games.json");
  const output = resolve(process.argv[3] ?? "public/feeds");
  const siteUrl = process.argv[4] ?? process.env.RSS_SITE_URL;
  if (!siteUrl) throw new Error("Provide the site URL as the fourth argument or RSS_SITE_URL");
  const data = JSON.parse(await readFile(input, "utf8")) as GamesFile;
  await writeRssFeeds(data.games, { outputDir: output, siteUrl });
  console.log(`Generated and validated ${1 + STORES.length} RSS feeds in ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
