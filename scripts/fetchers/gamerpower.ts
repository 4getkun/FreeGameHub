import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Game, GameType, Store } from "../../src/shared/types";

type Giveaway = {
  id: number | string;
  title: string;
  worth?: string;
  thumbnail?: string;
  description?: string;
  open_giveaway_url?: string;
  gamerpower_url?: string;
  published_date?: string;
  type?: string;
  platforms?: string;
  end_date?: string;
};
type Config = {
  gamerpower: { platforms: Record<string, Store>; types: Record<string, GameType> };
};

const config = JSON.parse(readFileSync(new URL("../../config.json", import.meta.url), "utf8")) as Config;

function toUtc(value: string | undefined): string | null {
  if (!value || value.toUpperCase() === "N/A") return null;
  const iso = `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid GamerPower date: ${value}`);
  return date.toISOString();
}

function mapStore(platforms: string | undefined): Store {
  const stores = (platforms ?? "").split(",")
    .map(value => config.gamerpower.platforms[value.trim().toLowerCase()])
    .filter((store): store is Store => Boolean(store));
  for (const preferred of ["epic", "steam", "gog", "itch", "prime"] as const) {
    if (stores.includes(preferred)) return preferred;
  }
  return "other";
}

function mapType(value: string | undefined): GameType {
  return config.gamerpower.types[value?.trim().toLowerCase() ?? ""] ?? "other";
}

function cleanTitle(value: string): string {
  return value.replace(/\s*\([^)]*\)\s*Giveaway\s*$/i, "").replace(/\s*Giveaway\s*$/i, "").trim();
}

function parseWorth(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/[\d,]+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0].replaceAll(",", ""));
  return Number.isFinite(amount) ? amount : null;
}

export async function fetchGames(): Promise<Omit<Game, "status" | "summaryJa">[]> {
  const response = await fetch("https://www.gamerpower.com/api/giveaways");
  if (!response.ok) throw new Error(`GamerPower HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid GamerPower response");
  return (data as Giveaway[]).map(item => {
    if (item.id === undefined || !item.title) throw new Error("Invalid GamerPower giveaway");
    const endAt = toUtc(item.end_date);
    const url = item.open_giveaway_url || item.gamerpower_url;
    if (!url) throw new Error(`GamerPower giveaway missing URL: ${item.id}`);
    return {
      id: `gamerpower:${item.id}`,
      title: cleanTitle(item.title),
      titleEn: cleanTitle(item.title),
      store: mapStore(item.platforms),
      type: mapType(item.type),
      url,
      imageUrl: item.thumbnail ?? null,
      startAt: toUtc(item.published_date),
      endAt,
      endApprox: endAt !== null,
      worthUsd: parseWorth(item.worth),
      source: "gamerpower" as const,
      descriptionOrig: item.description ?? null
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fetchGames().then(games => console.log(JSON.stringify(games, null, 2))).catch(error => {
    console.error(`GamerPower fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
