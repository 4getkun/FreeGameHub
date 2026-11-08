import type { Game } from "../../src/shared/types";
import { notificationText, type NotificationContext, type NotificationKind } from "../../src/shared/notification-format";

export const name = "telegram";
export function isEnabled(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

export async function send(game: Game, kind: NotificationKind, ctx: NotificationContext, env: NodeJS.ProcessEnv): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: notificationText(game, kind, ctx),
        link_preview_options: { is_disabled: false }
      })
    });
  } catch {
    throw new Error("Telegram delivery failed");
  }
  if (!response.ok) throw new Error("Telegram delivery failed");
  const result = await response.json() as { ok?: boolean };
  if (!result.ok) throw new Error("Telegram delivery failed");
}

export type { NotificationKind as NotifyKind, NotificationContext as NotifyContext } from "../../src/shared/notification-format";
