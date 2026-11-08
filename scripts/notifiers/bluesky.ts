import type { Game } from "../../src/shared/types";
import { notificationText, type NotificationContext, type NotificationKind } from "../../src/shared/notification-format";

export const name = "bluesky";
export function isEnabled(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD);
}

interface Session { accessJwt: string; did: string; }
interface UploadedBlob { blob: { $type: "blob"; ref: { $link: string }; mimeType: string; size: number }; }

function serviceUrl(env: NodeJS.ProcessEnv): string {
  return (env.BLUESKY_SERVICE_URL || "https://bsky.social").replace(/\/+$/, "");
}

type Grapheme = { segment: string };
type GraphemeSegmenter = { segment(input: string): Iterable<Grapheme> };
const Segmenter = (Intl as unknown as {
  Segmenter: new (locales: string, options: { granularity: "grapheme" }) => GraphemeSegmenter;
}).Segmenter;

export function limitGraphemes(text: string, limit: number): string {
  if (limit <= 0) return "";
  const graphemes = [...new Segmenter("ja-JP", { granularity: "grapheme" }).segment(text)].map(item => item.segment);
  return graphemes.length <= limit ? text : `${graphemes.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

async function createSession(base: string, env: NodeJS.ProcessEnv): Promise<Session> {
  let response: Response;
  try {
    response = await fetch(`${base}/xrpc/com.atproto.server.createSession`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD })
    });
  } catch { throw new Error("Bluesky authentication failed"); }
  if (!response.ok) throw new Error("Bluesky authentication failed");
  const session = await response.json() as Partial<Session>;
  if (!session.accessJwt || !session.did) throw new Error("Bluesky authentication failed");
  return session as Session;
}

async function uploadThumbnail(base: string, accessJwt: string, imageUrl: string): Promise<UploadedBlob["blob"] | undefined> {
  try {
    const image = await fetch(imageUrl);
    if (!image.ok) return undefined;
    const contentType = image.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
    if (!contentType.startsWith("image/")) return undefined;
    const bytes = await image.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 1_000_000) return undefined;
    const uploaded = await fetch(`${base}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST", headers: { authorization: `Bearer ${accessJwt}`, "content-type": contentType }, body: bytes
    });
    if (!uploaded.ok) return undefined;
    const data = await uploaded.json() as Partial<UploadedBlob>;
    return data.blob?.ref?.$link ? data.blob : undefined;
  } catch {
    // The external embed remains a link card even when its optional thumbnail cannot be uploaded.
    return undefined;
  }
}

export async function send(game: Game, kind: NotificationKind, ctx: NotificationContext, env: NodeJS.ProcessEnv): Promise<void> {
  const base = serviceUrl(env);
  const session = await createSession(base, env);
  const thumb = game.imageUrl ? await uploadThumbnail(base, session.accessJwt, game.imageUrl) : undefined;
  const text = limitGraphemes(notificationText(game, kind, ctx), 300);
  const external = {
    uri: game.url,
    title: game.title,
    description: (game.summaryJa || game.descriptionOrig || text).slice(0, 300),
    ...(thumb ? { thumb } : {})
  };
  let response: Response;
  try {
    response = await fetch(`${base}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST", headers: {
        authorization: `Bearer ${session.accessJwt}`, "content-type": "application/json"
      },
      body: JSON.stringify({
        repo: session.did, collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString(),
          embed: { $type: "app.bsky.embed.external", external }
        }
      })
    });
  } catch { throw new Error("Bluesky post failed"); }
  if (!response.ok) throw new Error("Bluesky post failed");
}

export type { NotificationKind as NotifyKind, NotificationContext as NotifyContext } from "../../src/shared/notification-format";
