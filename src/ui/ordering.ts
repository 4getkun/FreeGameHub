import type { Game } from "../shared/types";

/** Sorts by earliest end time; unknown dates stay last and ties retain input order. */
export function orderByEndAt<T extends Pick<Game, "endAt">>(games: readonly T[]): T[] {
  return games.map((game, index) => ({ game, index, time: game.endAt === null ? Number.POSITIVE_INFINITY : Date.parse(game.endAt) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ game }) => game);
}

/** Shows the nearest scheduled start first; missing dates remain last. */
export function orderByStartAt<T extends Pick<Game, "startAt">>(games: readonly T[]): T[] {
  return games.map((game, index) => ({ game, index, time: game.startAt === null ? Number.POSITIVE_INFINITY : Date.parse(game.startAt) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ game }) => game);
}
