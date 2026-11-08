import { describe, expect, it } from "vitest";
import { makeGamesFile, pruneExpiredGames } from "../scripts/store";
import type { Game } from "../src/shared/types";

const now = new Date("2026-11-08T00:00:00Z");
function game(id: string, endAt: string | null): Game {
  return { id, title: id, titleEn: null, store: "epic", type: "game", url: "https://example.com", imageUrl: null, startAt: null, endAt, status: "ended", endApprox: false, worthUsd: null, source: "epic", descriptionOrig: null, summaryJa: null };
}

describe("store retention", () => {
  it("keeps recent, boundary, and unknown-end games while removing games older than 30 days", () => {
    const input = [game("old", "2026-10-08T23:59:59.999Z"), game("boundary", "2026-10-09T00:00:00Z"), game("recent", "2026-11-07T00:00:00Z"), game("unknown", null)];
    expect(pruneExpiredGames(input, now).map(item => item.id)).toEqual(["boundary", "recent", "unknown"]);
  });

  it("sets updatedAt and applies retention when building the persisted data", () => {
    const result = makeGamesFile([game("old", "2026-10-01T00:00:00Z"), game("current", null)], now);
    expect(result).toEqual({ updatedAt: now.toISOString(), games: [game("current", null)] });
  });
});
