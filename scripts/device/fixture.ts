import type { Game, GamesFile } from "../../src/shared/types";

const DAY = 24 * 60 * 60 * 1000;

/** Build deterministic, schema-shaped UI data relative to `now` for device checks. */
export function createDeviceFixture(now = new Date(), count = 200): GamesFile {
  if (!Number.isFinite(now.getTime())) throw new RangeError("now must be a valid date");
  if (!Number.isInteger(count) || count < 5) throw new RangeError("count must be an integer of at least 5");

  const at = (offset: number): string => new Date(now.getTime() + offset).toISOString();
  const games: Game[] = [
    makeGame("fixture-active", "配布中のゲーム", "epic", "game", at(5 * DAY)),
    makeGame("fixture-ending", "終了間近のDLC", "steam", "dlc", at(2 * 60 * 60 * 1000)),
    makeGame("fixture-approx", "終了日概算のアイテム", "gog", "loot", at(DAY), { endApprox: true }),
    makeGame("fixture-upcoming", "次回予告のベータ", "itch", "beta", at(8 * DAY), {
      startAt: at(2 * DAY), status: "upcoming",
    }),
    makeGame("fixture-ended", "終了済みの特典", "prime", "other", at(-DAY), { status: "ended" }),
  ];

  const stores: Game["store"][] = ["epic", "steam", "gog", "itch", "prime", "other"];
  const types: Game["type"][] = ["game", "dlc", "loot", "beta", "other"];
  while (games.length < count) {
    const index = games.length - 5;
    games.push(makeGame(
      `fixture-bulk-${String(index + 1).padStart(3, "0")}`,
      `表示確認用ゲーム ${index + 1}`,
      stores[index % stores.length],
      types[index % types.length],
      at((3 + index % 20) * DAY),
    ));
  }

  return { updatedAt: now.toISOString(), games };
}

function makeGame(
  id: string,
  title: string,
  store: Game["store"],
  type: Game["type"],
  endAt: string,
  overrides: Partial<Game> = {},
): Game {
  return {
    id, title, titleEn: null, store, type,
    url: "https://example.com/",
    imageUrl: null, startAt: null, endAt, status: "active", endApprox: false,
    worthUsd: null, source: "epic", descriptionOrig: null, summaryJa: null,
    ...overrides,
  };
}
