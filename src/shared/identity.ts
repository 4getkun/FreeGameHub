import type { Game } from "./types";

/** Identifies one distribution period while preserving IDs with unknown start dates. */
export function distributionIdentity(game: Pick<Game, "id" | "startAt">): string {
  return game.startAt === null ? game.id : `${game.id}@${game.startAt}`;
}

export function notificationKey(game: Pick<Game, "id" | "startAt">, kind: string): string {
  return `${distributionIdentity(game)}:${kind}`;
}
