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

  it("keeps a same-title new offer separate from retained ended history", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "games.json");
    await writeGamesFile([game({
      id: "epic:old-copy", title: "Returning Game", endAt: "2026-11-07T00:00:00Z", status: "ended"
    })], gamesPath, now);
    await writeFile(join(root, "notified.json"), "{}\n");
    await runUpdate({
      now, gamesPath, feedsDir: join(root, "feeds"), statePath: join(root, "notified.json"),
      siteUrl: "https://site.example/", env: {}, notifiers: [],
      fetchers: [fetcher("epic", [fetched({ id: "epic:new-copy", title: "Returning Game", endAt: "2026-11-20T00:00:00Z" })]), fetcher("gamerpower", [])]
    });
    const saved = await readGamesFile(gamesPath);
    expect(saved?.games.find(item => item.id === "epic:new-copy")?.status).toBe("active");
    expect(saved?.games.find(item => item.id === "epic:old-copy")?.status).toBe("ended");
  });

  it("rearms notifications for a changed promotion period on the same active Epic ID", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "games.json");
    const feedsDir = join(root, "feeds");
    const statePath = join(root, "notified.json");
    const recurring = game({ id: "epic:recurring", title: "Recurring", status: "active", startAt: "2026-11-01T00:00:00Z" });
    await writeGamesFile([recurring], gamesPath, now);
    await writeRssFeeds([recurring], { outputDir: feedsDir, siteUrl: "https://site.example/" });
    await writeFile(statePath, JSON.stringify({ "epic:recurring:new": ["test", "healthy"], "epic:recurring:ending-soon": ["test", "healthy"] }));
    const send = vi.fn<Notifier["send"]>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const healthySend = vi.fn<Notifier["send"]>(async () => {});
    const notifiers = [testNotifier(send), { ...testNotifier(healthySend), name: "healthy" }];
    let startAt = "2026-11-01T00:00:00Z";
    const run = () => runUpdate({
      now, gamesPath, feedsDir, statePath, siteUrl: "https://site.example/", env: {}, notifiers,
      fetchers: [fetcher("epic", [fetched({ id: "epic:recurring", title: "Recurring", startAt, endAt: "2026-11-20T00:00:00Z" })]), fetcher("gamerpower", [])]
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await run();
    expect(send).not.toHaveBeenCalled();
    expect(healthySend).not.toHaveBeenCalled();
    startAt = "2026-11-08T00:00:00Z";
    await run();
    const feed = await readFile(join(feedsDir, "all.xml"), "utf8");
    expect((feed.match(/<item>/g) ?? [])).toHaveLength(2);
    expect(feed).toContain("epic:recurring@2026-11-01T00:00:00Z");
    expect(feed).toContain("epic:recurring@2026-11-08T00:00:00Z");
    expect(send).toHaveBeenCalledTimes(1);
    expect(healthySend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(statePath, "utf8"))["epic:recurring@2026-11-08T00:00:00Z:new"]).toEqual(["healthy"]);
    expect(JSON.parse(await readFile(statePath, "utf8"))).not.toHaveProperty("epic:recurring@2026-11-08T00:00:00Z:ending-soon");
    await run();
    expect(send).toHaveBeenCalledTimes(2);
    expect(healthySend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(statePath, "utf8"))["epic:recurring@2026-11-08T00:00:00Z:new"]).toEqual(["healthy", "test"]);
    await run();
    expect(send).toHaveBeenCalledTimes(2);
    expect(healthySend).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("keeps a new active transition pending if RSS persistence fails, then writes it on retry", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "games.json");
    const feedsDir = join(root, "feeds");
    const statePath = join(root, "notified.json");
    const upcoming = game({ id: "epic:pending", title: "Pending", startAt: "2026-11-08T01:00:00Z", status: "upcoming" });
    await writeGamesFile([upcoming], gamesPath, now);
    await writeFile(feedsDir, "block directory creation");
    const transitionNow = new Date("2026-11-08T02:00:00Z");
    const run = (dir: string) => runUpdate({
      now: transitionNow, gamesPath, feedsDir: dir, statePath, siteUrl: "https://site.example/", env: {}, notifiers: [],
      fetchers: [fetcher("epic", []), fetcher("gamerpower", [])]
    });

    await expect(run(feedsDir)).rejects.toThrow();
    expect((await readGamesFile(gamesPath))?.games.find(item => item.id === "epic:pending")?.status).toBe("upcoming");
    await rm(feedsDir);
    await run(feedsDir);
    const feed = await readFile(join(feedsDir, "all.xml"), "utf8");
    expect(feed).toContain("epic:pending");
    expect((await readGamesFile(gamesPath))?.games.find(item => item.id === "epic:pending")?.status).toBe("active");
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
    expect(await readFile(statePath, "utf8")).toContain("epic:old@2026-11-01T00:00:00Z:new");

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

  it("enriches newly added games only", async () => {
    const root = await tempRoot();
    const gamesPath = join(root, "games.json");
    await writeGamesFile([game({id:"epic:existing",descriptionOrig:"Existing description"})], gamesPath, now);
    await writeFile(join(root, "notified.json"), "{}\n");
    const network = vi.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:"新しいゲーム"}}]})});
    vi.stubGlobal("fetch", network);
    await runUpdate({now,gamesPath,feedsDir:join(root,"feeds"),statePath:join(root,"notified.json"),env:{GROQ_API_KEY:"test",GROQ_MODEL:"test"},notifiers:[],fetchers:[fetcher("epic",[fetched({id:"epic:existing",descriptionOrig:"Existing description"}),fetched({id:"epic:new",title:"New",titleEn:"New",descriptionOrig:"New description"})]),fetcher("gamerpower",[])]});
    expect(network).toHaveBeenCalledTimes(1);
    const saved = await readGamesFile(gamesPath);
    expect(saved?.games.find(item=>item.id === "epic:existing")?.summaryJa).toBeNull();
    expect(saved?.games.find(item=>item.id === "epic:new")?.summaryJa).toBe("新しいゲーム");
  });

  it("runs four daily schedules and commits only when staged public data differs", async () => {
    const workflow = await readFile(resolveWorkflow(), "utf8");
    expect(workflow).toContain('cron: "0 0,6,12,18 * * *"');
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toContain("if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}");
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
