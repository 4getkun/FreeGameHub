import type { Game } from "../../src/shared/types";
import { notificationText, type NotificationContext, type NotificationKind } from "../../src/shared/notification-format";

export const name = "ntfy";
export function isEnabled(env: NodeJS.ProcessEnv): boolean { return Boolean(env.NTFY_TOPIC); }
export async function send(game: Game, kind: NotificationKind, ctx: NotificationContext, env: NodeJS.ProcessEnv): Promise<void> {
  const base = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
  const response = await fetch(`${base}/${encodeURIComponent(env.NTFY_TOPIC!)}`, {
    method: "POST", headers: { Title: kind === "new" ? "New free game" : "Ending soon", "Content-Type": "text/plain; charset=utf-8" },
    body: notificationText(game, kind, ctx)
  });
  if (!response.ok) throw new Error("ntfy delivery failed");
}

export type { NotificationKind as NotifyKind, NotificationContext as NotifyContext } from "../../src/shared/notification-format";
