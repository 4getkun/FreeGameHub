export type Store = "epic" | "steam" | "gog" | "itch" | "prime" | "other";
export type GameType = "game" | "dlc" | "loot" | "beta" | "other";
export type Status = "active" | "upcoming" | "ended";
export interface Game {
  id: string; title: string; store: Store; type: GameType; url: string;
  imageUrl: string | null; startAt: string | null; endAt: string | null;
  status: Status; endApprox: boolean; worthUsd: number | null; source: "epic" | "gamerpower";
  descriptionOrig: string | null; summaryJa: string | null;
}
export interface GamesFile { updatedAt: string; games: Game[]; }
