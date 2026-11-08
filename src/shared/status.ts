import type { Game, Status } from "./types";
export function computeStatus(game: Pick<Game, "startAt" | "endAt">, now: Date): Status {
  if (game.endAt === null) return "active";
  if (game.startAt && Date.parse(game.startAt) > now.getTime()) return "upcoming";
  if (Date.parse(game.endAt) <= now.getTime()) return "ended";
  return "active";
}
