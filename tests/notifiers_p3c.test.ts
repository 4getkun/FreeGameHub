import { afterEach, describe, expect, it, vi } from "vitest";
import * as slack from "../scripts/notifiers/slack";
import * as telegram from "../scripts/notifiers/telegram";
import * as bluesky from "../scripts/notifiers/bluesky";
import { limitGraphemes } from "../scripts/notifiers/bluesky";
import * as mastodon from "../scripts/notifiers/mastodon";
import { loadNotifiers } from "../scripts/notifiers";
import type { Game } from "../src/shared/types";

const game: Game = {
  id: "epic:sample", title: "Sample Game", titleEn: "Sample Game", store: "epic", type: "game",
  url: "https://store.example/game", imageUrl: "https://img.example/game.png", startAt: "2026-11-08T00:00:00Z",
  endAt: "2026-11-10T00:00:00Z", status: "active", endApprox: false, worthUsd: null,
  source: "epic", descriptionOrig: "A sample description", summaryJa: "日本語の紹介"
};
const ctx = { upcoming: [] as Game[] };

function okJson(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("P3c notifier channels", () => {
  it("discovers all four P3c modules without changing the registry", async () => {
    const names = (await loadNotifiers()).map(notifier => notifier.name);
    expect(names).toEqual(expect.arrayContaining(["slack", "telegram", "bluesky", "mastodon"]));
  });

  it("enables each channel only when its required configuration is present", () => {
    expect(slack.isEnabled({})).toBe(false);
    expect(slack.isEnabled({ SLACK_WEBHOOK_URL: "https://hooks.slack.example/secret" })).toBe(true);
    expect(telegram.isEnabled({ TELEGRAM_BOT_TOKEN: "token" })).toBe(false);
    expect(telegram.isEnabled({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "-1001" })).toBe(true);
    expect(bluesky.isEnabled({ BLUESKY_HANDLE: "bot.example" })).toBe(false);
    expect(bluesky.isEnabled({ BLUESKY_HANDLE: "bot.example", BLUESKY_APP_PASSWORD: "app-secret" })).toBe(true);
    expect(mastodon.isEnabled({})).toBe(false);
    expect(mastodon.isEnabled({ MASTODON_BASE_URL: "https://social.example" })).toBe(false);
    expect(mastodon.isEnabled({ MASTODON_BASE_URL: "https://social.example", MASTODON_ACCESS_TOKEN: "token" })).toBe(true);
  });

  it("sends Slack incoming-webhook JSON with the shared notification text", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(okJson({ ok: true }));
    vi.stubGlobal("fetch", request);
    const env = { SLACK_WEBHOOK_URL: "https://hooks.slack.example/secret" };
    await slack.send(game, "new", ctx, env);
    expect(request).toHaveBeenCalledWith(env.SLACK_WEBHOOK_URL, expect.objectContaining({ method: "POST" }));
    const payload = JSON.parse(request.mock.calls[0][1]?.body as string);
    expect(Object.keys(payload)).toEqual(["text"]);
    expect(payload.text).toContain("新着無料ゲーム: Sample Game");
    expect(payload.text).toContain(game.url);
  });

  it("sends Telegram Bot API sendMessage JSON with link previews enabled", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(okJson({ ok: true, result: { message_id: 42 } }));
    vi.stubGlobal("fetch", request);
    const env = { TELEGRAM_BOT_TOKEN: "bot-token-secret", TELEGRAM_CHAT_ID: "@freegames" };
    await telegram.send(game, "ending-soon", ctx, env);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botbot-token-secret/sendMessage");
    const payload = JSON.parse(init?.body as string);
    expect(payload).toMatchObject({ chat_id: "@freegames", link_preview_options: { is_disabled: false } });
    expect(payload.text).toContain("まもなく終了: Sample Game");
  });

  it("posts a Bluesky external link card with an uploaded thumbnail blob", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(okJson({ accessJwt: "access-secret", did: "did:plc:sample" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }))
      .mockResolvedValueOnce(okJson({ blob: { $type: "blob", ref: { $link: "bafkreiabc" }, mimeType: "image/png", size: 3 } }))
      .mockResolvedValueOnce(okJson({ uri: "at://did:plc:sample/app.bsky.feed.post/record" }));
    vi.stubGlobal("fetch", request);
    const env = {
      BLUESKY_HANDLE: "bot.example", BLUESKY_APP_PASSWORD: "app-password-secret",
      BLUESKY_SERVICE_URL: "https://pds.example/"
    };
    await bluesky.send(game, "new", ctx, env);

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://pds.example/xrpc/com.atproto.server.createSession",
      game.imageUrl,
      "https://pds.example/xrpc/com.atproto.repo.uploadBlob",
      "https://pds.example/xrpc/com.atproto.repo.createRecord"
    ]);
    const recordRequest = request.mock.calls[3][1];
    expect(recordRequest?.headers).toMatchObject({ authorization: "Bearer access-secret" });
    const payload = JSON.parse(recordRequest?.body as string);
    expect(payload.repo).toBe("did:plc:sample");
    expect(payload.collection).toBe("app.bsky.feed.post");
    expect(payload.record.embed).toEqual({
      $type: "app.bsky.embed.external",
      external: {
        uri: game.url, title: game.title, description: game.summaryJa,
        thumb: { $type: "blob", ref: { $link: "bafkreiabc" }, mimeType: "image/png", size: 3 }
      }
    });
  });

  it("keeps long title and upcoming text within 300 graphemes without splitting a cluster", async () => {
    const longGame = { ...game, title: `${"a".repeat(278)}👨‍👩‍👧‍👦${"b".repeat(80)}`, summaryJa: null, imageUrl: null };
    const upcoming = { ...game, id: "epic:next", title: "次回配布".repeat(100), startAt: "2026-11-12T00:00:00Z", status: "upcoming" as const };
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(okJson({ accessJwt: "access-secret", did: "did:plc:sample" }))
      .mockResolvedValueOnce(okJson({ uri: "at://did:plc:sample/app.bsky.feed.post/record" }));
    vi.stubGlobal("fetch", request);
    await bluesky.send(longGame, "new", { upcoming: [upcoming] }, { BLUESKY_HANDLE: "bot", BLUESKY_APP_PASSWORD: "secret" });

    const payload = JSON.parse(request.mock.calls[1][1]?.body as string);
    const text = payload.record.text as string;
    const graphemes = [...new Intl.Segmenter("ja-JP", { granularity: "grapheme" }).segment(text)].map(item => item.segment);
    expect(graphemes.length).toBeLessThanOrEqual(300);
    expect(graphemes.at(-1)).toBe("…");
    expect(text).toContain("👨‍👩‍👧‍👦");
    expect(payload.record.embed.$type).toBe("app.bsky.embed.external");
    expect(payload.record.embed.external.uri).toBe(game.url);
  });

  it("truncates only at grapheme boundaries", () => {
    const family = "👨‍👩‍👧‍👦";
    const limited = limitGraphemes(`${"a".repeat(298)}${family}tail`, 300);
    const clusters = [...new Intl.Segmenter("ja-JP", { granularity: "grapheme" }).segment(limited)].map(item => item.segment);
    expect(clusters).toHaveLength(300);
    expect(clusters[298]).toBe(family);
    expect(clusters[299]).toBe("…");
  });

  it("sends Mastodon status with bearer authentication and public visibility", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(okJson({ id: "42", content: "posted" }));
    vi.stubGlobal("fetch", request);
    const env = { MASTODON_BASE_URL: "https://social.example/", MASTODON_ACCESS_TOKEN: "mastodon-secret" };
    await mastodon.send(game, "new", ctx, env);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://social.example/api/v1/statuses");
    expect(init?.headers).toMatchObject({ authorization: "Bearer mastodon-secret" });
    expect(JSON.parse(init?.body as string)).toEqual({
      status: expect.stringContaining("新着無料ゲーム: Sample Game"), visibility: "public"
    });
  });

  it("replaces transport errors with a generic message that cannot expose secrets", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("app-password-secret"));
    vi.stubGlobal("fetch", request);
    await expect(slack.send(game, "new", ctx, { SLACK_WEBHOOK_URL: "https://hooks.slack.example/secret" }))
      .rejects.toThrow("Slack delivery failed");
  });
});
