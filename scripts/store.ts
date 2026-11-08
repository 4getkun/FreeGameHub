import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Game, GamesFile } from "../src/shared/types";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Drops ended offers whose end timestamp is more than 30 days old. */
export function pruneExpiredGames(games: Game[], now = new Date()): Game[] {
  const cutoff = now.getTime() - RETENTION_MS;
  return games.filter(game => game.endAt === null || Date.parse(game.endAt) >= cutoff);
}

export function makeGamesFile(games: Game[], now = new Date()): GamesFile {
  return { updatedAt: now.toISOString(), games: pruneExpiredGames(games, now) };
}

export async function readGamesFile(filePath = "public/data/games.json"): Promise<GamesFile | null> {
  try {
    return JSON.parse(await readFile(resolve(filePath), "utf8")) as GamesFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeGamesFile(games: Game[], filePath = "public/data/games.json", now = new Date()): Promise<GamesFile> {
  const data = makeGamesFile(games, now);
  const target = resolve(filePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}
