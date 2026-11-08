import type { Game } from "./types";

export type NotificationKind = "new" | "ending-soon";
export interface NotificationContext { upcoming: Game[]; }

function newEndLabel(game: Game): string {
  if (!game.endAt) return "（終了日時不明）";
  if (game.endApprox) return `（${new Date(game.endAt).toISOString().slice(0, 10)}まで）`;
  const exact = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(game.endAt));
  return `（${exact}まで）`;
}

/** Formats notification text without depending on the notifier registry. */
export function notificationText(game: Game, kind: NotificationKind, ctx: NotificationContext): string {
  if (kind === "ending-soon") return `まもなく終了: ${game.title}\n${game.url}\n終了: ${new Date(game.endAt!).toISOString()}`;
  let text = `新着無料ゲーム: ${game.title}${newEndLabel(game)}\n${game.url}`;
  if (game.source === "epic") {
    const next = ctx.upcoming.filter(candidate => candidate.startAt)
      .sort((a, b) => Date.parse(a.startAt!) - Date.parse(b.startAt!))[0];
    if (next) {
      const start = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(new Date(next.startAt!));
      text += `\n次回: ${next.title}（${start}開始）`;
    }
  }
  return text;
}
