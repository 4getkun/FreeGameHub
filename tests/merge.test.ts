import { describe, expect, it } from "vitest";
import { mergeGames } from "../scripts/merge";
import type { Game } from "../src/shared/types";

const now = new Date("2026-11-08T00:00:00Z");
function game(overrides: Partial<Omit<Game, "status" | "summaryJa">> = {}): Omit<Game, "status" | "summaryJa"> {
  return {
    id: "epic:flotsam", title: "Flotsam", store: "epic", type: "game",
    url: "https://store.example/flotsam", imageUrl: "https://img.example/flotsam.jpg",
    startAt: "2026-11-05T16:00:00Z", endAt: "2026-11-12T16:00:00Z", endApprox: false,
    worthUsd: null, source: "epic", descriptionOrig: null, ...overrides,
    titleEn: overrides.titleEn ?? overrides.title ?? "Flotsam"
  };
}

describe("mergeGames", () => {
  it("deduplicates Flotsam and keeps Epic dates, URL, image and precise end while filling GamerPower worth/type", () => {
    const result = mergeGames([
      game({ title: "Flotsam •Y—¬ƒKƒ‰ƒNƒ^ƒEƒ“", titleEn: "Flotsam" }),
      game({ id: "gamerpower:3845", title: "Flotsam", titleEn: "Flotsam", type: "dlc", url: "https://gamerpower.example/flotsam", imageUrl: "https://gp.example/image.jpg", startAt: "2026-11-05T11:06:40Z", endAt: "2026-11-12T23:59:00Z", endApprox: true, worthUsd: 24.99, source: "gamerpower" })
    ], now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "epic:flotsam", title: "Flotsam •Y—¬ƒKƒ‰ƒNƒ^ƒEƒ“", type: "dlc", url: "https://store.example/flotsam", imageUrl: "https://img.example/flotsam.jpg", startAt: "2026-11-05T16:00:00Z", endAt: "2026-11-12T16:00:00Z", endApprox: false, worthUsd: 24.99, source: "epic", status: "active" });
  });

  it("recomputes upcoming and ended status from the supplied clock", () => {
    const results = mergeGames([
      game({ id: "upcoming", title: "Upcoming", startAt: "2026-11-09T00:00:00Z" }),
      game({ id: "ended", title: "Ended", endAt: "2026-11-07T00:00:00Z" })
    ], now);
    expect(results.map(item => item.status)).toEqual(["upcoming", "ended"]);
  });

  it("matches a short Flotsam title at a word boundary when UTC end dates agree", () => {
    const result = mergeGames([
      game(),
      game({ id: "gamerpower:flotsam", title: "Flotsam: æ¼‚æµã‚¬ãƒ©ã‚¯ã‚¿ã‚¦ãƒ³ Giveaway", titleEn: "Flotsam Giveaway", source: "gamerpower", worthUsd: 12 })
    ], now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "epic:flotsam", worthUsd: 12 });
  });

  it("does not prefix-match across UTC end dates, for short prefixes, or inside a word", () => {
    const base = game({ title: "Flotsam Definitive", titleEn: "Flotsam Definitive" });
    const result = mergeGames([
      base,
      game({ id: "different-day", title: "Flotsam", titleEn: "Flotsam", endAt: "2026-11-13T00:00:00Z" }),
      game({ id: "short", title: "Foo", titleEn: "Foo" }),
      game({ id: "short-long", title: "Foo Deluxe", titleEn: "Foo Deluxe" }),
      game({ id: "inside-word", title: "Flotsam", titleEn: "Flotsam", store: "steam" }),
      game({ id: "suffix", title: "Flotsamish", titleEn: "Flotsamish" })
    ], now);
    expect(result).toHaveLength(6);
  });

});
