import type { Game } from "../../src/shared/types";
import { notificationText, type NotificationContext, type NotificationKind } from "../../src/shared/notification-format";

export const name = "slack";
export function isEnabled(env: NodeJS.ProcessEnv): boolean { return Boolean(env.SLACK_WEBHOOK_URL); }

export async function send(game: Game, kind: NotificationKind, ctx: NotificationContext, env: NodeJS.ProcessEnv): Promise<void> {
  let response: Response;
  try {
    response = await fetch(env.SLACK_WEBHOOK_URL!, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: notificationText(game, kind, ctx) })
    });
  } catch {
    throw new Error("Slack delivery failed");
  }
  if (!response.ok) throw new Error("Slack delivery failed");
}

export type { NotificationKind as NotifyKind, NotificationContext as NotifyContext } from "../../src/shared/notification-format";
