import type { Game } from "../../src/shared/types";
import { notificationText, type NotificationContext, type NotificationKind } from "../../src/shared/notification-format";

export const name = "discord";
export function isEnabled(env: NodeJS.ProcessEnv): boolean { return Boolean(env.DISCORD_WEBHOOK_URL); }
export async function send(game: Game, kind: NotificationKind, ctx: NotificationContext, env: NodeJS.ProcessEnv): Promise<void> {
  const roleId = kind === "new" ? env.DISCORD_ROLE_ID : undefined;
  const response = await fetch(env.DISCORD_WEBHOOK_URL!, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: roleId ? `<@&${roleId}>` : undefined,
      allowed_mentions: { roles: roleId ? [roleId] : [] },
      embeds: [{
        title: game.title, url: game.url,
        description: notificationText(game, kind, ctx),
        ...(game.imageUrl ? { image: { url: game.imageUrl } } : {})
      }]
    })
  });
  if (!response.ok) throw new Error("Discord delivery failed");
}

export type { NotificationKind as NotifyKind, NotificationContext as NotifyContext } from "../../src/shared/notification-format";
