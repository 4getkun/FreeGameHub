import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readGamesFile, writeGamesFile } from "../scripts/store";
import { writeRssFeeds } from "../scripts/outputs/rss";
import { runUpdate, type UpdateFetcher } from "../scripts/run";
import type { Notifier } from "../scripts/notifiers";
import type { Game } from "../src/shared/types";

const now = new Date("2026-11-08T00:00:00Z");
const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "freegamehub-run-"));
  roots.push(root);
  return root;
}

function game(overrides: Partial<Game> = {}): Game {
  const result: Game = {
    id: "epic:old", title: "Old Game", titleEn: "Old Game", store: "epic", type: "game",
    url: "https://store.example/game", imageUrl: null, startAt: "2026-11-01T00:00:00Z",
    endAt: "2026-11-20T00:00:00Z", status: "active", endApprox: false, worthUsd: null,
    source: "epic", descriptionOrig: null, summaryJa: null, ...overrides
  };
  result.titleEn = overrides.titleEn ?? overrides.title ?? result.title;
  return result;
}

function fetcher(source: Game["source"], games: Omit<Game, "status" | "summaryJa">[] | Error): UpdateFetcher {
  return { source, async fetchGames() { if (games instanceof Error) throw games; return games; } };
}

function fetched(overrides: Partial<Omit<Game, "status" | "summaryJa">> = {}): Omit<Game, "status" | "summaryJa"> {
  const { status: _status, summaryJa: _summary, ...item } = game(overrides);
  return item;
}

function testNotifier(send: Notifier["send"]): Notifier {
  return { name: "test", isEnabled: () => true, send };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("P4 update runner", () => {
  it("preserves every existing public file when all fetchers fail", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "public/data/games.json");
    const feedsDir = join(root, "public/feeds");
    const statePath = join(root, "public/data/notified.json");
    await writeGamesFile([game()], gamesPath, now);
    await import("node:fs/promises").then(fs => fs.mkdir(feedsDir, { recursive: true }));
    await writeFile(join(feedsDir, "all.xml"), "keep-feed");
    await writeFile(statePath, '{"existing:new":["test"]}\n');
    const before = await Promise.all([readFile(gamesPath, "utf8"), readFile(join(feedsDir, "all.xml"), "utf8"), readFile(statePath, "utf8")]);
    const result = await runUpdate({
      now, gamesPath, feedsDir, statePath, siteUrl: "https://site.example/", env: {},
      fetchers: [fetcher("epic", new Error("secret")), fetcher("gamerpower", new Error("secret"))]
    });
    const after = await Promise.all([readFile(gamesPath, "utf8"), readFile(join(feedsDir, "all.xml"), "utf8"), readFile(statePath, "utf8")]);
    expect(result.reason).toBe("all-fetchers-failed");
    expect(after).toEqual(before);
  });

  it("retains absent active/upcoming offers and recent ended history, then prunes history older than 30 days", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "games.json");
    const old = [
      game({ id: "epic:missing", title: "Missing Epic" }),
      game({ id: "gamerpower:retained", source: "gamerpower", store: "steam", title: "Failed source old offer" }),
      game({ id: "epic:upcoming-missing", title: "Missing Upcoming", startAt: "2026-11-09T00:00:00Z", endAt: "2026-11-20T00:00:00Z", status: "upcoming" }),
      game({ id: "epic:recent-ended", title: "Recent ended", endAt: "2026-10-29T00:00:00Z", status: "ended" }),
      game({ id: "epic:expired", title: "Expired", endAt: "2026-10-07T23:59:59Z", status: "ended" })
    ];
    await writeFile(gamesPath, `${JSON.stringify({ updatedAt: now.toISOString(), games: old }, null, 2)}\n`);
    await writeFile(join(root, "notified.json"), "{}\n");
    const result = await runUpdate({
      now, gamesPath, feedsDir: join(root, "feeds"), statePath: join(root, "notified.json"),
      siteUrl: "https://site.example/", env: {}, notifiers: [],
      fetchers: [fetcher("epic", [fetched({ id: "epic:new", title: "New Epic" })]), fetcher("gamerpower", new Error("unavailable"))]
    });
    const saved = await readGamesFile(gamesPath);
    expect(result.failedSources).toEqual(["gamerpower"]);
    expect(saved?.games.map(item => item.id).sort()).toEqual(["epic:missing", "epic:new", "epic:recent-ended", "epic:upcoming-missing", "gamerpower:retained"]);
  });

  it("does not RSS-add a previously active absent offer, but does add an upcoming-to-active transition", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "games.json");
    const feedsDir = join(root, "feeds");
    const statePath = join(root, "notified.json");
    const active = game({ id: "epic:already-active", title: "Already Active" });
    const upcoming = game({ id: "epic:transition", title: "Was Upcoming", startAt: "2026-11-08T01:00:00Z", status: "upcoming" });
    await writeGamesFile([active, upcoming], gamesPath, now);
    await writeRssFeeds([], { outputDir: feedsDir, siteUrl: "https://site.example/" });
    await writeFile(statePath, JSON.stringify({ "epic:already-active:new": ["test"], "epic:transition:new": ["test"] }));
    const transitionNow = new Date("2026-11-08T02:00:00Z");
    await runUpdate({
      now: transitionNow, gamesPath, feedsDir, statePath, siteUrl: "https://site.example/", env: {}, notifiers: [],
      fetchers: [fetcher("epic", []), fetcher("gamerpower", [])]
    });
    const feed = await readFile(join(feedsDir, "all.xml"), "utf8");
    expect(feed).toContain("epic:transition");
    expect(feed).not.toContain("epic:already-active");
    const saved = await readGamesFile(gamesPath);
    expect(saved?.games.find(item => item.id === "epic:transition")?.status).toBe("active");
    expect(saved?.games.some(item => item.id === "epic:already-active")).toBe(true);
  });

  it("bootstraps existing active games silently, then sends only newly active games and appends RSS once", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "games.json");
    const feedsDir = join(root, "feeds");
    const statePath = join(root, "notified.json");
    const old = fetched({ id: "epic:old", title: "Old Game" });
    const next = fetched({ id: "epic:new", title: "New Game" });
    const upcoming = fetched({ id: "epic:upcoming", title: "Upcoming Game", startAt: "2026-11-10T00:00:00Z", endAt: "2026-11-15T00:00:00Z" });
    const send = vi.fn<Notifier["send"]>(async () => {});
    const notifier = testNotifier(send);

    const first = await runUpdate({
      now, gamesPath, feedsDir, statePath, siteUrl: "https://site.example/", env: {}, notifiers: [notifier],
      fetchers: [fetcher("epic", [old]), fetcher("gamerpower", [])]
    });
    expect(first.dataChanged).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(await readFile(statePath, "utf8")).toContain("epic:old:new");

    await runUpdate({
      now, gamesPath, feedsDir, statePath, siteUrl: "https://site.example/", env: {}, notifiers: [notifier],
      fetchers: [fetcher("epic", [old, next, upcoming]), fetcher("gamerpower", [])]
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: "epic:new" }), "new", expect.objectContaining({ upcoming: [expect.objectContaining({ id: "epic:upcoming" })] }), {});
    const allFeed = await readFile(join(feedsDir, "all.xml"), "utf8");
    expect((allFeed.match(/<guid isPermaLink=/g) ?? [])).toHaveLength(2);
    expect(allFeed).toContain("epic:old");
    expect(allFeed).toContain("epic:new");
    expect(allFeed).not.toContain("epic:upcoming");
  });

  it("does not send or touch games.json when there are no channel secrets and nothing changed", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "games.json");
    const statePath = join(root, "notified.json");
    const feedsDir = join(root, "feeds");
    await writeGamesFile([game()], gamesPath, new Date("2026-11-07T00:00:00Z"));
    await writeFile(statePath, "{}\n");
    const before = await readFile(gamesPath, "utf8");
    const network = vi.spyOn(globalThis, "fetch");
    const result = await runUpdate({
      now, gamesPath, feedsDir, statePath, env: {},
      fetchers: [fetcher("epic", [fetched()]), fetcher("gamerpower", [])]
    });
    expect(result).toMatchObject({ reason: "unchanged", dataChanged: false });
    expect(await readFile(gamesPath, "utf8")).toBe(before);
    expect(await readFile(join(feedsDir, "all.xml"), "utf8")).toContain("https://github.com/4getkun/FreeGameHub");
    expect(network).not.toHaveBeenCalled();
  });

  it("runs four daily schedules and commits only when staged public data differs", async () => {
    const workflow = await readFile(resolveWorkflow(), "utf8");
    expect(workflow).toContain('cron: "0 0,6,12,18 * * *"');
    expect(workflow).toMatch(/workflow_dispatch:/);
    const noChange = workflow.indexOf("if git diff --cached --quiet -- public; then");
    const noCommit = workflow.indexOf("No public data changes");
    const commitElse = workflow.indexOf("else", noChange);
    const commit = workflow.indexOf("git -c user.name", commitElse);
    const push = workflow.indexOf("git push origin", commit);
    expect(noChange).toBeGreaterThanOrEqual(0);
    expect(noChange).toBeLessThan(noCommit);
    expect(noCommit).toBeLessThan(commitElse);
    expect(commitElse).toBeLessThan(commit);
    expect(commit).toBeLessThan(push);
  });
});

function resolveWorkflow(): string {
  return resolve(process.cwd(), ".github/workflows/update.yml");
}
