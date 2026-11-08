import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { gamesFileSchema } from "../src/shared/schema";
import type { Game, GamesFile } from "../src/shared/types";
import { computeStatus } from "../src/shared/status";
import { mergeGames, type FetchedGame } from "./merge";
import { enrich } from "./enrich";
import { pruneExpiredGames, readGamesFile, writeGamesFile } from "./store";
import { fetchGames as fetchEpicGames } from "./fetchers/epic";
import { fetchGames as fetchGamerPowerGames } from "./fetchers/gamerpower";
import { writeRssFeeds } from "./outputs/rss";
import { runNotifications, type Notifier } from "./notifiers";

const DEFAULT_SITE_URL = "https://github.com/4getkun/FreeGameHub";

export interface UpdateFetcher {
  source: Game["source"];
  fetchGames(): Promise<FetchedGame[]>;
}

export interface UpdateOptions {
  now?: Date;
  gamesPath?: string;
  feedsDir?: string;
  statePath?: string;
  siteUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetchers?: UpdateFetcher[];
  notifiers?: Notifier[];
}

export interface UpdateResult {
  updated: boolean;
  reason: "updated" | "unchanged" | "all-fetchers-failed";
  successfulSources: Game["source"][];
  failedSources: Game["source"][];
  gameCount: number;
  dataChanged: boolean;
}

function asFetched(game: Game): FetchedGame {
  const { status: _status, summaryJa: _summaryJa, ...fetched } = game;
  return fetched;
}

function sameGames(left: Game[], right: Game[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadExisting(path: string): Promise<GamesFile | null> {
  const raw = await readGamesFile(path);
  if (!raw) return null;
  const parsed = gamesFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Existing games.json does not match the data contract");
  return parsed.data;
}

/**
 * Fetches sources independently, protects failed sources, then stores data and runs outputs.
 * On a first run without games.json, current active offers seed RSS; the notifier state bootstraps them as already seen and sends nothing.
 */
export async function runUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const gamesPath = options.gamesPath ?? "public/data/games.json";
  const feedsDir = options.feedsDir ?? "public/feeds";
  const statePath = options.statePath ?? "public/data/notified.json";
  const siteUrl = options.siteUrl ?? env.RSS_SITE_URL ?? DEFAULT_SITE_URL;
  const fetchers = options.fetchers ?? [
    { source: "epic" as const, fetchGames: fetchEpicGames },
    { source: "gamerpower" as const, fetchGames: fetchGamerPowerGames }
  ];
  const previous = await loadExisting(gamesPath);
  const results = await Promise.all(fetchers.map(async fetcher => {
    try { return { source: fetcher.source, games: await fetcher.fetchGames(), failed: false as const }; }
    catch { return { source: fetcher.source, games: [] as FetchedGame[], failed: true as const }; }
  }));
  const successfulSources = results.filter(item => !item.failed).map(item => item.source);
  const failedSources = results.filter(item => item.failed).map(item => item.source);
  for (const source of failedSources) console.error(`[update] ${source} fetch failed; retaining previous data`);
  if (successfulSources.length === 0) {
    return { updated: false, reason: "all-fetchers-failed", successfulSources, failedSources, gameCount: previous?.games.length ?? 0, dataChanged: false };
  }

  const incoming = results.flatMap(item => item.failed ? [] : item.games);
  const incomingIds = new Set(incoming.map(game => game.id));
  // Keep absent tracked offers from every source; status is recalculated and store prunes ended items after 30 days.
  const retained = (previous?.games ?? []).filter(game => !incomingIds.has(game.id));
  // Ended history is archival: do not let an old same-title offer absorb a new distribution in mergeGames.
  const endedHistory = retained.filter(game => computeStatus(game, now) === "ended");
  const liveRetained = retained.filter(game => computeStatus(game, now) !== "ended");
  const merged = mergeGames([...liveRetained.map(asFetched), ...incoming], now);
  const mergedIds = new Set(merged.map(game => game.id));
  const withEndedHistory = [
    ...merged,
    ...endedHistory.filter(game => !mergedIds.has(game.id)).map(game => ({ ...game, status: computeStatus(game, now) }))
  ];
  const oldById = new Map((previous?.games ?? []).map(game => [game.id, game]));
  const withPreviousSummaries = withEndedHistory.map(game => ({
    ...game,
    summaryJa: oldById.get(game.id)?.summaryJa ?? null
  }));
  const newGames = withPreviousSummaries.filter(game => !oldById.has(game.id));
  const enriched = await enrich(newGames, { max: 30, env });
  const enrichedById = new Map(enriched.map(game => [game.id, game]));
  const finalFile = gamesFileSchema.parse({ updatedAt: now.toISOString(), games: pruneExpiredGames(withPreviousSummaries.map(game => enrichedById.get(game.id) ?? game), now) });
  const dataChanged = !previous || !sameGames(previous.games, finalFile.games);

  const activeGames = finalFile.games.filter(game => game.status === "active");
  const previousById = new Map((previous?.games ?? []).map(game => [game.id, game]));
  // On the first run, seed RSS with the current active set; without prior state no transition can be inferred.
  const newlyActive = activeGames.filter(game => previous
    ? previousById.get(game.id)?.status !== "active"
    : true);
  const newlyPromoted = activeGames.filter(game => {
    const previousGame = previousById.get(game.id);
    return previousGame?.status === "active" && previousGame.startAt !== game.startAt;
  });
  // Persist the RSS transition first: if that write fails, the old games.json status remains retryable.
  await writeRssFeeds([...newlyActive, ...newlyPromoted], { outputDir: feedsDir, siteUrl });
  if (dataChanged) await writeGamesFile(finalFile.games, gamesPath, now);
  await runNotifications(finalFile.games, {
    upcoming: finalFile.games.filter(game => game.status === "upcoming")
  }, env, { now, statePath, notifiers: options.notifiers, newlyActiveIds: [...newlyActive, ...newlyPromoted].map(game => game.id) });

  return {
    updated: dataChanged,
    reason: dataChanged ? "updated" : "unchanged",
    successfulSources,
    failedSources,
    gameCount: finalFile.games.length,
    dataChanged
  };
}

async function main(): Promise<void> {
  const result = await runUpdate();
  console.log(`[update] ${result.reason}; ${result.gameCount} games; successful=${result.successfulSources.join(",")}; failed=${result.failedSources.join(",")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("[update] run failed");
    process.exitCode = 1;
  });
}
