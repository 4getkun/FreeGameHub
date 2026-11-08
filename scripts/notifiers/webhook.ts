import type { Game } from "../../src/shared/types";
import type { NotificationContext, NotificationKind } from "../../src/shared/notification-format";

export const name = "webhook";
export function isEnabled(env: NodeJS.ProcessEnv): boolean { return Boolean(env.GENERIC_WEBHOOK_URL); }
export async function send(game: Game, kind: NotificationKind, ctx: NotificationContext, env: NodeJS.ProcessEnv): Promise<void> {
  const response = await fetch(env.GENERIC_WEBHOOK_URL!, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ game, kind, upcoming: kind === "new" && game.source === "epic" ? ctx.upcoming : [] })
  });
  if (!response.ok) throw new Error("Webhook delivery failed");
}

export type { NotificationKind as NotifyKind, NotificationContext as NotifyContext } from "../../src/shared/notification-format";
