import type { Game } from "../../src/shared/types";
import { notificationText, type NotificationContext, type NotificationKind } from "../../src/shared/notification-format";

export const name = "mastodon";
export function isEnabled(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.MASTODON_BASE_URL && env.MASTODON_ACCESS_TOKEN);
}

export async function send(game: Game, kind: NotificationKind, ctx: NotificationContext, env: NodeJS.ProcessEnv): Promise<void> {
  const base = env.MASTODON_BASE_URL!.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1/statuses`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ status: notificationText(game, kind, ctx), visibility: "public" })
    });
  } catch {
    throw new Error("Mastodon delivery failed");
  }
  if (!response.ok) throw new Error("Mastodon delivery failed");
}

export type { NotificationKind as NotifyKind, NotificationContext as NotifyContext } from "../../src/shared/notification-format";
