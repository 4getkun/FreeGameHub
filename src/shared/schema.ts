import { z } from "zod";
import type { Game, GamesFile } from "./types";
const date = z.string().datetime();
export const gameSchema: z.ZodType<Game> = z.object({ id: z.string(), title: z.string(), titleEn: z.string().nullable(), store: z.enum(["epic", "steam", "gog", "itch", "prime", "other"]), type: z.enum(["game", "dlc", "loot", "beta", "other"]), url: z.string(), imageUrl: z.string().nullable(), startAt: date.nullable(), endAt: date.nullable(), status: z.enum(["active", "upcoming", "ended"]), endApprox: z.boolean(), worthUsd: z.number().nullable(), source: z.enum(["epic", "gamerpower"]), descriptionOrig: z.string().nullable(), summaryJa: z.string().nullable() });
export const gamesFileSchema: z.ZodType<GamesFile> = z.object({ updatedAt: date, games: z.array(gameSchema) });
