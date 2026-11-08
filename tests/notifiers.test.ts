import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNotifiers, readNotifiedFile, runNotifications, type Notifier } from "../scripts/notifiers";
import { isEnabled as webhookEnabled, send as sendWebhook } from "../scripts/notifiers/webhook";
import { send as sendDiscord } from "../scripts/notifiers/discord";
import { notificationText } from "../src/shared/notification-format";
import type { Game } from "../src/shared/types";

const now = new Date("2026-11-08T00:00:00Z");
const contexts = { upcoming: [] as Game[] };
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "freegamehub-notifier-"));
  tempDirs.push(path);
  return path;
}

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "epic:one", title: "One", titleEn: "One", store: "epic", type: "game", url: "https://example.test/one",
    imageUrl: null, startAt: "2026-11-07T00:00:00Z", endAt: null, status: "active", endApprox: false,
    worthUsd: null, source: "epic", descriptionOrig: null, summaryJa: null, ...overrides
  };
}

function channel(name: string, send: Notifier["send"], enabled = true): Notifier {
  return { name, isEnabled: () => enabled, send };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("notifier registry and delivery", () => {
  it("discovers modules by filename and loads the three built-in channels", async () => {
    const builtins = await loadNotifiers();
    expect(builtins.map(item => item.name)).toEqual(expect.arrayContaining(["discord", "ntfy", "webhook"]));
    const dir = await tempDir();
    await writeFile(join(dir, "custom.mjs"), 'export const name="custom"; export const isEnabled=()=>true; export const send=async()=>{};');
    await writeFile(join(dir, "index.mjs"), 'throw new Error("registry file must not be loaded as a channel");');
    expect((await loadNotifiers(dir)).map(item => item.name)).toEqual(["custom"]);
  });

  it("formats approximate end dates in UTC and precise dates in JST", () => {
    const approximate = notificationText(game({ endAt: "2026-11-08T15:30:00Z", endApprox: true }), "new", contexts);
    const precise = notificationText(game({ endAt: "2026-11-08T15:30:00Z", endApprox: false }), "new", contexts);
    expect(approximate).toContain("2026-11-08まで");
    expect(precise).toContain("2026/11/09 00:30まで");
  });

  it("sends Discord embeds with an image and only the configured new-game role mention", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendDiscord(game({ imageUrl: "https://img.example/cover.jpg" }), "new", contexts, {
      DISCORD_WEBHOOK_URL: "https://discord.example/webhook/token", DISCORD_ROLE_ID: "123456"
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.content).toBe("<@&123456>");
    expect(body.allowed_mentions.roles).toEqual(["123456"]);
    expect(body.embeds[0]).toMatchObject({ title: "One", url: "https://example.test/one", image: { url: "https://img.example/cover.jpg" } });
    await sendDiscord(game(), "ending-soon", contexts, { DISCORD_WEBHOOK_URL: "https://discord.example/webhook/token", DISCORD_ROLE_ID: "123456" });
    const ending = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(ending.content).toBeUndefined();
    expect(ending.allowed_mentions.roles).toEqual([]);
  });

  it("uses GENERIC_WEBHOOK_URL and sends exactly the contract payload fields", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const upcoming = game({ id: "epic:next", title: "Next", status: "upcoming", startAt: "2026-11-12T00:00:00Z" });
    const ctx = { upcoming: [upcoming] };
    expect(webhookEnabled({ GENERIC_WEBHOOK_URL: "https://hook.example/secret" })).toBe(true);
    expect(webhookEnabled({ WEBHOOK_URL: "https://hook.example/old" })).toBe(false);
    await sendWebhook(game(), "new", ctx, { GENERIC_WEBHOOK_URL: "https://hook.example/secret" });
    expect(fetchMock).toHaveBeenCalledWith("https://hook.example/secret", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(Object.keys(body).sort()).toEqual(["game", "kind", "upcoming"]);
    expect(body).toEqual({ game: game(), kind: "new", upcoming: [upcoming] });
  });

  it("suppresses the first run, then sends newly active games and records success", async () => {
    const statePath = join(await tempDir(), "data", "notified.json");
    const send = vi.fn<Notifier["send"]>(async () => {});
    const notifier = channel("test", send);
    const initial = await runNotifications([game()], contexts, {}, { statePath, now, notifiers: [notifier] });
    expect(initial).toEqual({ initialized: true, attempts: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await readNotifiedFile(statePath)).toEqual({ "epic:one:new": ["test"] });

    const next = game({ id: "steam:two", title: "Two", store: "steam", source: "gamerpower" });
    await runNotifications([game(), next], contexts, {}, { statePath, now, notifiers: [notifier] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(next, "new", contexts, {});
  });

  it("skips every built-in channel when no secrets are configured", async () => {
    const statePath = join(await tempDir(), "notified.json");
    await writeFile(statePath, "{}\n");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));
    const result = await runNotifications([game({ id: "steam:no-secret", store: "steam" })], contexts, {}, { statePath, now });
    expect(result.attempts).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips channels without secrets and retries only the failed channel", async () => {
    const statePath = join(await tempDir(), "notified.json");
    await writeFile(statePath, "{}\n");
    const noSecret = vi.fn(async () => {});
    const disabled = channel("disabled", noSecret, false);
    const flakySend = vi.fn().mockRejectedValueOnce(new Error("secret-url must not appear in logs")).mockResolvedValue(undefined);
    const flaky = channel("flaky", flakySend);
    const healthySend = vi.fn(async () => {});
    const healthy = channel("healthy", healthySend);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifiers = [disabled, flaky, healthy];

    await runNotifications([game()], contexts, {}, { statePath, now, notifiers });
    expect(noSecret).not.toHaveBeenCalled();
    expect(flakySend).toHaveBeenCalledTimes(1);
    expect(healthySend).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret-url");

    await runNotifications([game()], contexts, {}, { statePath, now, notifiers });
    expect(flakySend).toHaveBeenCalledTimes(2);
    expect(healthySend).toHaveBeenCalledTimes(1);
  });

  it("sends ending-soon once and excludes approximate end dates", async () => {
    const statePath = join(await tempDir(), "notified.json");
    await writeFile(statePath, JSON.stringify({ "epic:soon:new": ["test"], "epic:approx:new": ["test"] }));
    const send = vi.fn(async () => {});
    const notifier = channel("test", send);
    const soon = game({ id: "epic:soon", endAt: "2026-11-08T12:00:00Z" });
    const approximate = game({ id: "epic:approx", endAt: "2026-11-08T12:00:00Z", endApprox: true });
    await runNotifications([soon, approximate], contexts, {}, { statePath, now, notifiers: [notifier] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(soon, "ending-soon", contexts, {});
    await runNotifications([soon, approximate], contexts, {}, { statePath, now, notifiers: [notifier] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("applies channel store/type filters and limits each channel to ten sends", async () => {
    const statePath = join(await tempDir(), "notified.json");
    await writeFile(statePath, "{}\n");
    const send = vi.fn<Notifier["send"]>(async () => {});
    const notifier = channel("test", send);
    const games = Array.from({ length: 12 }, (_, i) => game({ id: `steam:${i}`, store: "steam" }))
      .concat(game({ id: "epic:filtered", store: "epic" }), game({ id: "steam:dlc", store: "steam", type: "dlc" }));
    const env = { TEST_STORES: "steam", TEST_TYPES: "game" };
    const result = await runNotifications(games, contexts, env, { statePath, now, notifiers: [notifier] });
    expect(result.attempts).toBe(10);
    expect(send).toHaveBeenCalledTimes(10);
    expect(send.mock.calls.every(([sentGame]) => sentGame.store === "steam" && sentGame.type === "game")).toBe(true);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(Object.keys(state)).toHaveLength(10);
  });
});
