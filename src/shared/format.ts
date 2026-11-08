import type { Game } from "./types";

const jst = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function formatEnd(game: Pick<Game, "endAt" | "endApprox">, now = new Date()): { text: string; countdown: string | null; imminent: boolean } {
  if (!game.endAt) return { text: "終了日時不明", countdown: null, imminent: false };
  const end = new Date(game.endAt);
  if (!Number.isFinite(end.getTime())) return { text: "終了日時不明", countdown: null, imminent: false };
  if (game.endApprox) {
    const date = game.endAt.slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(`${today}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { text: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}まで`, countdown: null, imminent: date >= today && date <= tomorrow.toISOString().slice(0, 10) };
  }
  const text = `${jst.format(end)}まで`;
  const remaining = end.getTime() - now.getTime();
  return { text, countdown: remaining > 0 ? countdownText(remaining) : null, imminent: remaining > 0 && remaining <= 24 * 60 * 60 * 1000 };
}

export function countdownText(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return days > 0 ? `残り${days}日${hours}時間` : hours > 0 ? `残り${hours}時間${minutes}分` : `残り${minutes}分`;
}

export function isWithinRecentHistory(endAt: string | null, now: Date, days = 30): boolean {
  return endAt !== null && Date.parse(endAt) >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

