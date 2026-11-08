import { describe, expect, it } from "vitest";
import { generateRssFeeds, validateRssFeed } from "../scripts/outputs/rss";
import type { Game } from "../src/shared/types";

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "epic:dlc&one", title: "A < B", titleEn: "A < B", store: "epic", type: "dlc",
    url: "https://store.example/a?x=1&y=2", imageUrl: null, startAt: "2026-11-08T00:00:00Z",
    endAt: null, status: "active", endApprox: false, worthUsd: null, source: "epic",
    descriptionOrig: "<script>& test", summaryJa: null, ...overrides
  };
}

describe("RSS output", () => {
  it("generates validated RSS 2.0 overall and per-store feeds from new active offers", () => {
    const feeds = generateRssFeeds([
      game(), game({ id: "steam:upcoming", store: "steam", status: "upcoming" }),
      game({ id: "prime:active", store: "prime", type: "game", title: "Plain title" })
    ], { siteUrl: "https://site.example/" });
    expect(Object.keys(feeds)).toEqual(["all.xml", "epic.xml", "steam.xml", "gog.xml", "itch.xml", "prime.xml", "other.xml"]);
    expect(Object.values(feeds).every(validateRssFeed)).toBe(true);
    expect(validateRssFeed(feeds["all.xml"].replace(/\n/g, "\r\n"))).toBe(true);
    expect(feeds["all.xml"]).toContain("<rss version=\"2.0\">");
    expect(feeds["all.xml"]).toContain("<title>[DLC] A &lt; B</title>");
    expect(feeds["all.xml"]).toContain("<guid isPermaLink=\"false\">epic:dlc&amp;one</guid>");
    expect(feeds["all.xml"]).toContain("https://store.example/a?x=1&amp;y=2");
    expect(feeds["all.xml"]).toContain("&lt;script&gt;&amp; test");
    expect(feeds["all.xml"]).not.toContain("steam:upcoming");
    expect(feeds["prime.xml"]).toContain("<title>Plain title</title>");
    expect(feeds["epic.xml"]).toContain("epic:dlc&amp;one");
    expect(feeds["steam.xml"]).not.toContain("<item>");
    expect(feeds["all.xml"]).toContain("<link>https://site.example/</link>");
  });

  it("preserves ended history and avoids duplicate GUIDs on repeated runs", () => {
    const first = generateRssFeeds([game()], { siteUrl: "https://site.example/" });
    const repeated = generateRssFeeds([game()], { siteUrl: "https://site.example/", existingFeeds: first });
    const again = generateRssFeeds([], { siteUrl: "https://site.example/", existingFeeds: repeated });
    expect(again).toEqual(repeated);
    expect((repeated["all.xml"].match(/<guid isPermaLink=/g) ?? [])).toHaveLength(1);
    const afterEnd = generateRssFeeds([game({ status: "ended" })], {
      siteUrl: "https://site.example/", existingFeeds: repeated
    });
    expect(afterEnd["all.xml"]).toContain("epic:dlc&amp;one");
    expect((afterEnd["all.xml"].match(/<item>/g) ?? [])).toHaveLength(1);
    expect(validateRssFeed(afterEnd["all.xml"])).toBe(true);
  });

  it("requires an explicit channel URL", () => {
    expect(() => generateRssFeeds([game()], { siteUrl: "" })).toThrow("siteUrl must be provided");
  });

  it("rejects malformed structure or a missing item guid", () => {
    expect(validateRssFeed("<rss></rss>")).toBe(false);
    expect(validateRssFeed('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><item></item></channel>\n</rss>\n')).toBe(false);
  });
});
