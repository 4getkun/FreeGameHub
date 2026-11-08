import type { Game, GameType } from "../src/shared/types";
import { computeStatus } from "../src/shared/status";

export type FetchedGame = Omit<Game, "status" | "summaryJa">;

export function normalizeTitle(title: string): string {
  return title.normalize("NFKC").toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/gu, " ").trim();
}

function utcEndDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function matchTitle(a: FetchedGame, b: FetchedGame): "exact" | "prefix" | null {
  if (a.store !== b.store) return null;
  const equal = (left: string | null, right: string | null) =>
    left !== null && right !== null && normalizeTitle(left) === normalizeTitle(right);
  if (equal(a.titleEn, b.titleEn) || equal(a.title, b.title)) return "exact";
  if (!a.endAt || !b.endAt || utcEndDate(a.endAt) !== utcEndDate(b.endAt)) return null;
  const candidates = [
    [normalizeTitle(a.titleEn ?? ""), normalizeTitle(b.titleEn ?? "")],
    [normalizeTitle(a.title), normalizeTitle(b.title)],
    [normalizeTitle(a.titleEn ?? ""), normalizeTitle(b.title)],
    [normalizeTitle(a.title), normalizeTitle(b.titleEn ?? "")]
  ];
  return candidates.some(([left, right]) =>
    (left.length >= 4 && right.startsWith(`${left} `)) ||
    (right.length >= 4 && left.startsWith(`${right} `))
  ) ? "prefix" : null;
}

function withStatus(game: FetchedGame, now: Date): Game {
  const complete: Game = { ...game, status: "active", summaryJa: null };
  return { ...complete, status: computeStatus(complete, now) };
}

/** Combines only contract-defined title matches, preferring Epic fields. */
export function mergeGames(input: FetchedGame[], now = new Date()): Game[] {
  const merged: Game[] = [];
  for (const fetched of input) {
    const matchAt = merged.findIndex(existing => matchTitle(existing, fetched) !== null);
    if (matchAt < 0) {
      merged.push(withStatus(fetched, now));
      continue;
    }
    const current = merged[matchAt];
    const incoming = withStatus(fetched, now);
    const preferred = current.source === "epic" ? current : incoming.source === "epic" ? incoming : current;
    const supplemental = preferred === current ? incoming : current;
    if (matchTitle(current, fetched) === "prefix") {
      console.info(`[merge] title-prefix match: "${current.title}" / "${incoming.title}"; end dates ${utcEndDate(current.endAt!)} / ${utcEndDate(incoming.endAt!)}`);
    }
    const combined: Game = {
      ...preferred,
      worthUsd: preferred.worthUsd ?? supplemental.worthUsd,
      type: (preferred.source === "epic" ? supplemental.type : preferred.type) as GameType
    };
    merged[matchAt] = { ...combined, status: computeStatus(combined, now) };
  }
  return merged;
}
